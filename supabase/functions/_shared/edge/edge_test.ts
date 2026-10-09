import { assertEquals, assertRejects } from '@std/assert'
import { bearerToken, hasBearerSecret } from './auth.ts'
import { addressResolver, isDnsNotFound } from './dns.ts'
import { readEnv, publicAppUrl } from './env.ts'
import { readJsonBody, readTextLimited, withTimeout } from './http.ts'
import { createAdminClient, DatabaseError, serviceRoleKey } from './supabase.ts'

const withAuth = (value?: string) => new Request('http://localhost/', { method: 'POST', headers: value ? { Authorization: value } : {} })

Deno.test('hasBearerSecret accepts any configured secret and fails closed', async () => {
  assertEquals(bearerToken(withAuth('bearer  abc ')), 'abc')
  assertEquals(await hasBearerSecret(withAuth('Bearer probe-secret'), ['probe-secret', 'runner-secret']), true)
  assertEquals(await hasBearerSecret(withAuth('Bearer runner-secret'), [undefined, 'runner-secret']), true)
  assertEquals(await hasBearerSecret(withAuth('Bearer runner-secre'), ['runner-secret']), false)
  assertEquals(await hasBearerSecret(withAuth(), ['runner-secret']), false)
  // No secret configured: nothing is accepted, not even an empty token.
  assertEquals(await hasBearerSecret(withAuth('Bearer '), [undefined, '']), false)
})

Deno.test('readEnv trims and ignores empty values', () => {
  Deno.env.set('UPVANE_TEST_VALUE', '  hello ')
  Deno.env.set('PUBLIC_APP_URL', 'https://app.upvane.dev///')
  try {
    assertEquals(readEnv('UPVANE_TEST_VALUE'), 'hello')
    assertEquals(readEnv('UPVANE_TEST_MISSING'), undefined)
    assertEquals(publicAppUrl(), 'https://app.upvane.dev')
  } finally {
    Deno.env.delete('UPVANE_TEST_VALUE')
    Deno.env.delete('PUBLIC_APP_URL')
  }
})

Deno.test('serviceRoleKey falls back to SUPABASE_SECRET_KEYS', () => {
  const previous = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
  Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_secret_abc' }))
  try {
    assertEquals(serviceRoleKey(), 'sb_secret_abc')
  } finally {
    Deno.env.delete('SUPABASE_SECRET_KEYS')
    if (previous) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previous)
  }
})

Deno.test('withTimeout aborts slow work and clears its timer', async () => {
  const error = await assertRejects(() => withTimeout(20, (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))))
  assertEquals((error as Error).name, 'TimeoutError')
  assertEquals(await withTimeout(1000, async () => 'done'), 'done')
})

Deno.test('readTextLimited stops at the limit', async () => {
  const full = await readTextLimited(new Response('hello world'), 100)
  assertEquals(full, { text: 'hello world', bytes: 11, truncated: false })
  const cut = await readTextLimited(new Response('hello world'), 5)
  assertEquals(cut, { text: 'hello', bytes: 5, truncated: true })
  assertEquals(await readTextLimited(new Response(null), 5), { text: '', bytes: 0, truncated: false })
})

Deno.test('readJsonBody handles empty and invalid bodies', async () => {
  assertEquals(await readJsonBody(new Request('http://localhost/', { method: 'POST', body: '' })), { ok: true, value: null })
  assertEquals(await readJsonBody(new Request('http://localhost/', { method: 'POST', body: '{"a":1}' })), { ok: true, value: { a: 1 } })
  assertEquals(await readJsonBody(new Request('http://localhost/', { method: 'POST', body: '{a' })), { ok: false })
})

Deno.test('addressResolver merges A and AAAA and only fails when both fail', async () => {
  const notFound = Object.assign(new Error('no records'), { name: 'NotFound' })
  const resolver = addressResolver(async (_host, type) => {
    if (type === 'A') return ['93.184.216.34']
    throw notFound
  })
  assertEquals(await resolver('example.com'), ['93.184.216.34'])
  assertEquals(isDnsNotFound(notFound), true)
  await assertRejects(() => addressResolver(async () => Promise.reject(notFound))('missing.example.com'))
})

Deno.test('admin client calls PostgREST RPCs with the service key', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    if (String(input).endsWith('/rpc/claim_monitor')) return new Response('null', { status: 200 })
    if (String(input).endsWith('/rpc/record_monitor_run')) return new Response(null, { status: 204 })
    if (String(input).includes('/monitors?')) return new Response('[{"id":"m1","type":"http"}]', { status: 200 })
    return new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }), { status: 404 })
  }) as typeof fetch
  const db = createAdminClient({ url: 'http://db.local/', serviceKey: 'a.b.c', fetch: fakeFetch })
  assertEquals(await db.rpc('claim_monitor', { p_monitor_id: 'm1' }), null)
  assertEquals(await db.rpc('record_monitor_run', {}), null)
  assertEquals(await db.select('monitors', { select: 'id,type', id: 'eq.m1' }), [{ id: 'm1', type: 'http' }])
  const error = await assertRejects(() => db.rpc('missing_fn'), DatabaseError)
  assertEquals([error.code, error.status], ['PGRST202', 404])

  assertEquals(calls[0]!.url, 'http://db.local/rest/v1/rpc/claim_monitor')
  assertEquals(calls[0]!.init.body, '{"p_monitor_id":"m1"}')
  const headers = calls[0]!.init.headers as Record<string, string>
  assertEquals([headers.apikey, headers.Authorization, headers['Content-Type']], ['a.b.c', 'Bearer a.b.c', 'application/json'])
  assertEquals(calls[2]!.url, 'http://db.local/rest/v1/monitors?select=id%2Ctype&id=eq.m1')
})

Deno.test('admin client sends new secret keys only as apikey and wraps network errors', async () => {
  let seen: Record<string, string> = {}
  const db = createAdminClient({
    url: 'http://db.local',
    serviceKey: 'sb_secret_abc',
    fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>
      throw new TypeError('fetch failed')
    }) as typeof fetch,
  })
  const error = await assertRejects(() => db.rpc('anything'), DatabaseError)
  assertEquals(error.code, 'network_error')
  assertEquals([seen.apikey, seen.Authorization], ['sb_secret_abc', undefined])
})
