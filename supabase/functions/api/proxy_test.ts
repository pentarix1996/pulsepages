import { assertEquals } from '@std/assert'
import { handleApiRequest, projectPath, toV0Body } from './proxy.ts'

const APP = 'https://app.upvane.dev'
const PROJECT = '44444444-4444-4444-8444-444444444444'

function withApp(run: () => Promise<void>): () => Promise<void> {
  return async () => {
    Deno.env.set('PUBLIC_APP_URL', APP)
    try {
      await run()
    } finally {
      Deno.env.delete('PUBLIC_APP_URL')
    }
  }
}

function upstream(respond: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} })
    return respond(String(input), init ?? {})
  }) as typeof fetch
  return { fetchImpl, seen }
}

Deno.test('projectPath accepts every legacy prefix and rejects traversal', () => {
  assertEquals(projectPath(`/functions/v1/api/v1/projects/${PROJECT}/components`), `projects/${PROJECT}/components`)
  assertEquals(projectPath(`/api/v1/projects/${PROJECT}/`), `projects/${PROJECT}`)
  assertEquals(projectPath('/v1/projects'), 'projects')
  assertEquals(projectPath('/api/v1/me'), null)
  assertEquals(projectPath(`/api/v1/projects/${PROJECT}/%2e%2e/%2e%2e/billing`), null)
  assertEquals(projectPath(`/api/v1/projects/a%2Fb`), null)
})

Deno.test('toV0Body renames the v1 envelope per route', () => {
  const list = { data: [{ id: 'c1' }], next_cursor: null }
  assertEquals(toV0Body(`projects/${PROJECT}/components`, 'GET', list), { components: [{ id: 'c1' }], next_cursor: null })
  assertEquals(toV0Body(`projects/${PROJECT}/components`, 'POST', { data: { id: 'c1' } }), { component: { id: 'c1' } })
  assertEquals(toV0Body(`projects/${PROJECT}/components/c1`, 'PUT', { data: { id: 'c1' } }), { component: { id: 'c1' } })
  assertEquals(toV0Body(`projects/${PROJECT}/incidents`, 'GET', { data: [] }), { incidents: [] })
  assertEquals(toV0Body(`projects/${PROJECT}/incidents`, 'POST', { data: { id: 'i1' } }), { incident: { id: 'i1' } })
  assertEquals(toV0Body(`projects/${PROJECT}/incidents/i1`, 'GET', { data: { id: 'i1' } }), { incident: { id: 'i1' } })
  assertEquals(toV0Body(`projects/${PROJECT}`, 'GET', { data: { id: PROJECT } }), { project: { id: PROJECT } })
  assertEquals(toV0Body(`projects/${PROJECT}/status`, 'GET', { data: { status: 'operational' } }), { status: 'operational' })
  assertEquals(toV0Body(`projects/${PROJECT}/incidents/i1/updates`, 'POST', { data: { id: 'u1' } }), { data: { id: 'u1' } })
})

Deno.test(
  'forwards method, auth, content type, idempotency key and body; marks the answer deprecated',
  withApp(async () => {
    const { fetchImpl, seen } = upstream(() => Response.json({ data: { id: 'c9', name: 'API' } }, { status: 201, headers: { 'X-Request-Id': 'req_1', 'X-RateLimit-Remaining': '599' } }))
    const response = await handleApiRequest(
      new Request(`http://localhost/api/v1/projects/${PROJECT}/components?limit=5`, {
        method: 'POST',
        headers: { Authorization: 'Bearer upv_live_x', 'Content-Type': 'application/json', 'Idempotency-Key': 'k1', Cookie: 'session=secret' },
        body: '{"name":"API"}',
      }),
      fetchImpl,
    )
    assertEquals(seen[0]!.url, `${APP}/api/v1/projects/${PROJECT}/components?limit=5`)
    const sent = seen[0]!.init.headers as Headers
    assertEquals([sent.get('authorization'), sent.get('content-type'), sent.get('idempotency-key'), sent.get('cookie')], ['Bearer upv_live_x', 'application/json', 'k1', null])
    assertEquals(new TextDecoder().decode(seen[0]!.init.body as ArrayBuffer), '{"name":"API"}')
    assertEquals(seen[0]!.init.method, 'POST')
    assertEquals(response.status, 201)
    assertEquals(await response.json(), { component: { id: 'c9', name: 'API' } })
    assertEquals(response.headers.get('deprecation'), 'true')
    assertEquals(response.headers.get('link'), `<${APP}/api/v1/openapi.json>; rel="successor-version"`)
    assertEquals([response.headers.get('x-request-id'), response.headers.get('x-ratelimit-remaining')], ['req_1', '599'])
    assertEquals(response.headers.get('access-control-allow-origin'), '*')
  }),
)

Deno.test(
  'errors pass through; deletes keep the v0 body; upstream failures are 503',
  withApp(async () => {
    const error = upstream(() => Response.json({ error: 'The API key is not valid.', code: 'unauthorized', request_id: 'req_2' }, { status: 401 }))
    const denied = await handleApiRequest(new Request(`http://localhost/api/v1/projects/${PROJECT}/incidents`), error.fetchImpl)
    assertEquals([denied.status, await denied.json()], [401, { error: 'The API key is not valid.', code: 'unauthorized', request_id: 'req_2' }])
    assertEquals(error.seen[0]!.init.body, undefined)

    const deleted = upstream(() => new Response(null, { status: 204 }))
    const gone = await handleApiRequest(new Request(`http://localhost/api/v1/projects/${PROJECT}/incidents/i1`, { method: 'DELETE' }), deleted.fetchImpl)
    assertEquals([gone.status, await gone.json()], [200, { success: true, message: 'Incident deleted' }])

    const broken = (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch
    const unavailable = await handleApiRequest(new Request(`http://localhost/api/v1/projects/${PROJECT}`), broken)
    assertEquals([unavailable.status, (await unavailable.json()).code], [503, 'unavailable'])

    const html = upstream(() => new Response('<html>Bad gateway</html>', { status: 502 }))
    const page = await handleApiRequest(new Request(`http://localhost/api/v1/projects/${PROJECT}`), html.fetchImpl)
    assertEquals([page.status, (await page.json()).code], [502, 'internal'])

    const notFound = await handleApiRequest(new Request('http://localhost/api/v1/whatever'), error.fetchImpl)
    assertEquals([notFound.status, (await notFound.json()).code], [404, 'not_found'])
    const preflight = await handleApiRequest(new Request('http://localhost/api/v1/projects', { method: 'OPTIONS' }))
    assertEquals([preflight.status, await preflight.text()], [200, 'ok'])
  }),
)
