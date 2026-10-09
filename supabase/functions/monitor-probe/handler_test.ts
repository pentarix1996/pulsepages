import { assertEquals } from '@std/assert'
import { handleProbeRequest } from './handler.ts'
import type { ProbeDeps } from './checks.ts'

const stubs: Partial<ProbeDeps> = {
  lookup: async (_hostname, type) => {
    if (type === 'A') return ['93.184.216.34']
    throw Object.assign(new Error('no records'), { name: 'NotFound' })
  },
  fetch: (async () => new Response('ok', { status: 200 })) as typeof fetch,
  now: () => new Date('2026-10-09T12:00:00Z'),
}

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>): () => Promise<void> {
  return async () => {
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Deno.env.get(key)]))
    for (const [key, value] of Object.entries(values)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value)
    try {
      await run()
    } finally {
      for (const [key, value] of Object.entries(previous)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value)
    }
  }
}

const probeCall = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer probe-secret', 'x-region': 'us-east-1' }) =>
  new Request('http://localhost/monitor-probe', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })

const httpBody = { monitor_id: 'm1', type: 'http', config: { url: 'https://api.example.com/health' }, timeout_ms: 5000, secret_headers: null }

Deno.test(
  'probe: authenticates with MONITOR_PROBE_SECRET or MONITOR_RUNNER_SECRET',
  withEnv({ MONITOR_PROBE_SECRET: 'probe-secret', MONITOR_RUNNER_SECRET: 'runner-secret', SB_REGION: undefined }, async () => {
    assertEquals((await handleProbeRequest(probeCall(httpBody), stubs)).status, 200)
    assertEquals((await handleProbeRequest(probeCall(httpBody, { Authorization: 'Bearer runner-secret' }), stubs)).status, 200)
    const denied = await handleProbeRequest(probeCall(httpBody, { Authorization: 'Bearer nope' }), stubs)
    assertEquals([denied.status, await denied.json()], [401, { error: 'Unauthorized.', code: 'unauthorized' }])
    assertEquals((await handleProbeRequest(new Request('http://localhost/', { method: 'GET' }), stubs)).status, 405)
  }),
)

Deno.test(
  'probe: fails closed when no secret is configured',
  withEnv({ MONITOR_PROBE_SECRET: undefined, MONITOR_RUNNER_SECRET: undefined }, async () => {
    const response = await handleProbeRequest(probeCall(httpBody), stubs)
    assertEquals(response.status, 503)
  }),
)

Deno.test(
  'probe: echoes x-region as a simulated region locally and SB_REGION in Supabase',
  withEnv({ MONITOR_PROBE_SECRET: 'probe-secret', SB_REGION: undefined }, async () => {
    const local = await (await handleProbeRequest(probeCall(httpBody), stubs)).json()
    assertEquals([local.region, local.status, local.details.region_simulated], ['us-east-1', 'up', true])
    Deno.env.set('SB_REGION', 'ap-southeast-1')
    const hosted = await (await handleProbeRequest(probeCall(httpBody), stubs)).json()
    assertEquals([hosted.region, hosted.details.region_simulated], ['ap-southeast-1', undefined])
  }),
)

Deno.test(
  'probe: bad requests answer an error ProbeResult',
  withEnv({ MONITOR_PROBE_SECRET: 'probe-secret', SB_REGION: undefined }, async () => {
    const invalid = await handleProbeRequest(probeCall('{nope'), stubs)
    const invalidBody = await invalid.json()
    assertEquals([invalid.status, invalidBody.status, invalidBody.error], [400, 'error', 'The request body is not valid JSON.'])
    const heartbeat = await handleProbeRequest(probeCall({ ...httpBody, type: 'heartbeat' }), stubs)
    assertEquals([heartbeat.status, (await heartbeat.json()).status], [400, 'error'])
  }),
)
