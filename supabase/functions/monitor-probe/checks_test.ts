import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { bytesToBase64, encryptJson } from '../_shared/crypto.ts'
import type { ProbeRequest } from '../_shared/monitoring/types.ts'
import { runCheck } from './checks.ts'
import type { ProbeDeps, TlsPeer } from './checks.ts'

const NOW = new Date('2026-10-09T12:00:00Z')
const KEY = bytesToBase64(new Uint8Array(32).fill(7))
const notFound = () => Object.assign(new Error('no records found'), { name: 'NotFound' })

interface Sent {
  url: string
  method: string
  headers: Headers
  body: string | null
}

type Route = (request: Sent) => Response | Promise<Response>

/** Deps with a fake DNS (hostname → addresses), fake fetch routes and a clock that advances 10 ms per read. */
function fakeDeps(options: { dns?: Record<string, string[]>; routes?: Record<string, Route>; overrides?: Partial<ProbeDeps>; tick?: number } = {}) {
  const sent: Sent[] = []
  const lookups: string[] = []
  let time = 0
  const dns: Record<string, string[]> = { 'api.example.com': ['93.184.216.34'], 'www.example.com': ['93.184.216.35'], ...options.dns }
  const deps: ProbeDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const request: Sent = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : null }
      sent.push(request)
      const route = options.routes?.[request.url]
      if (!route) throw new TypeError('fetch failed', { cause: new Error(`error sending request for url (${request.url}): client error (Connect): tcp connect error: Connection refused (os error 111)`) })
      return await route(request)
    }) as typeof fetch,
    lookup: async (hostname, type) => {
      lookups.push(`${type} ${hostname}`)
      if (type !== 'A') throw notFound()
      const addresses = dns[hostname]
      if (!addresses) throw notFound()
      return addresses
    },
    connectTcp: async () => undefined,
    tlsHandshake: async () => {
      throw new Error('not used')
    },
    secretsKey: KEY,
    now: () => NOW,
    clock: () => (time += options.tick ?? 10),
    ...options.overrides,
  }
  return { deps, sent, lookups }
}

const httpRequest = (config: Record<string, unknown>, extra: Partial<ProbeRequest> = {}): ProbeRequest => ({ monitor_id: 'm1', type: 'http', config, timeout_ms: 5000, secret_headers: null, ...extra })

Deno.test('http: up with latency, final URL and resolved addresses', async () => {
  const { deps, sent } = fakeDeps({ routes: { 'https://api.example.com/health': () => new Response('ok', { status: 200 }) } })
  const result = await runCheck(httpRequest({ url: 'https://api.example.com/health' }), 'eu-central-1', deps)
  assertEquals(result, {
    region: 'eu-central-1',
    status: 'up',
    latency_ms: 10,
    http_status: 200,
    error: null,
    checked_at: NOW.toISOString(),
    details: { final_url: 'https://api.example.com/health', redirects: 0, resolved_ips: ['93.184.216.34'] },
  })
  assertEquals(sent[0]!.headers.get('user-agent')?.startsWith('Upvane-Monitor/'), true)
})

Deno.test('http: follows redirects manually, re-checks SSRF per hop and keeps secrets on their origin', async () => {
  const secret_headers = await encryptJson([{ name: 'X-Api-Key', value: 'top-secret' }], KEY)
  const { deps, sent, lookups } = fakeDeps({
    routes: {
      'https://api.example.com/health': () => new Response(null, { status: 302, headers: { Location: '/v2/health' } }),
      'https://api.example.com/v2/health': () => new Response(null, { status: 301, headers: { Location: 'https://www.example.com/health' } }),
      'https://www.example.com/health': () => new Response('{"status":"ok"}', { status: 200 }),
    },
  })
  const result = await runCheck(httpRequest({ url: 'https://api.example.com/health', headers: [{ name: 'Authorization', value: 'Bearer t' }] }, { secret_headers }), 'us-east-1', deps)
  assertEquals(result.status, 'up')
  assertEquals(result.latency_ms, 30)
  assertEquals(result.details, {
    final_url: 'https://www.example.com/health',
    redirects: 2,
    redirect_chain: ['https://api.example.com/v2/health', 'https://www.example.com/health'],
    resolved_ips: ['93.184.216.35'],
  })
  assertEquals(sent.map((request) => request.headers.get('x-api-key')), ['top-secret', 'top-secret', null])
  assertEquals(sent.map((request) => request.headers.get('authorization')), ['Bearer t', 'Bearer t', null])
  assertEquals(lookups.filter((entry) => entry.startsWith('A ')), ['A api.example.com', 'A api.example.com', 'A www.example.com'])
})

Deno.test('http: a redirect to a private address or to http is blocked and the check is down', async () => {
  const { deps } = fakeDeps({
    dns: { 'internal.example.com': ['10.0.0.5'] },
    routes: { 'https://api.example.com/a': () => new Response(null, { status: 307, headers: { Location: 'https://internal.example.com/admin' } }) },
  })
  const result = await runCheck(httpRequest({ url: 'https://api.example.com/a' }), 'eu-central-1', deps)
  assertEquals(result.status, 'down')
  assertEquals(result.error, 'internal.example.com resolves to a private or reserved address.')
  assertEquals(result.details?.redirects, 1)

  const plain = fakeDeps({ routes: { 'https://api.example.com/a': () => new Response(null, { status: 301, headers: { Location: 'http://api.example.com/a' } }) } })
  const downgraded = await runCheck(httpRequest({ url: 'https://api.example.com/a' }), 'eu-central-1', plain.deps)
  assertEquals(downgraded.error, 'The redirect to http://api.example.com/a was blocked: Only https:// URLs can be monitored.')
})

Deno.test('http: redirects are not followed when follow_redirects is false, and loops stop after 5 hops', async () => {
  const { deps, sent } = fakeDeps({ routes: { 'https://api.example.com/a': () => new Response(null, { status: 301, headers: { Location: '/b' } }) } })
  const result = await runCheck(httpRequest({ url: 'https://api.example.com/a', follow_redirects: false }), 'eu-central-1', deps)
  assertEquals([result.status, result.http_status, sent.length], ['up', 301, 1])

  const loop = fakeDeps({
    routes: {
      'https://api.example.com/a': () => new Response(null, { status: 302, headers: { Location: '/b' } }),
      'https://api.example.com/b': () => new Response(null, { status: 302, headers: { Location: '/a' } }),
    },
  })
  const looped = await runCheck(httpRequest({ url: 'https://api.example.com/a' }), 'eu-central-1', loop.deps)
  assertEquals([looped.status, looped.error, loop.sent.length], ['down', 'Stopped after 5 redirects.', 6])
})

Deno.test('http: 303 after POST switches to GET without the body', async () => {
  const { deps, sent } = fakeDeps({
    routes: {
      'https://api.example.com/submit': () => new Response(null, { status: 303, headers: { Location: '/done' } }),
      'https://api.example.com/done': () => new Response('ok'),
    },
  })
  const result = await runCheck(httpRequest({ url: 'https://api.example.com/submit', method: 'POST', body: '{"ping":true}' }), 'eu-central-1', deps)
  assertEquals(result.status, 'up')
  assertEquals(sent.map((request) => [request.method, request.body, request.headers.get('content-type')]), [
    ['POST', '{"ping":true}', 'application/json'],
    ['GET', null, null],
  ])
})

Deno.test('keyword and assertions use the body; latency over the threshold degrades', async () => {
  const page = () => new Response('<h1>Sign in</h1>', { status: 200, headers: { 'content-type': 'text/html' } })
  const { deps } = fakeDeps({ routes: { 'https://api.example.com/login': page } })
  const found = await runCheck({ ...httpRequest({ url: 'https://api.example.com/login', keyword: 'sign in' }), type: 'keyword' }, 'eu-central-1', deps)
  assertEquals(found.status, 'up')
  const missing = await runCheck({ ...httpRequest({ url: 'https://api.example.com/login', keyword: 'Dashboard' }), type: 'keyword' }, 'eu-central-1', deps)
  assertEquals([missing.status, missing.error], ['down', 'The response does not contain "Dashboard".'])

  const json = fakeDeps({ tick: 1500, routes: { 'https://api.example.com/health': () => new Response('{"status":"degraded","db":{"ok":false}}') } })
  const asserted = await runCheck(
    httpRequest({
      url: 'https://api.example.com/health',
      latency_threshold_ms: 1000,
      assertions: [
        { source: 'json', path: 'status', operator: 'equals', value: 'ok', on_fail: 'degraded' },
        { source: 'header', path: 'x-missing', operator: 'not_exists' },
      ],
    }),
    'eu-central-1',
    json.deps,
  )
  assertEquals(asserted.status, 'degraded')
  assertEquals(asserted.details?.failures, ['JSON status expected to equal ok, got degraded.', 'Responded in 1500 ms, slower than 1000 ms.'])
})

Deno.test('http: target failures are down, probe failures are error', async () => {
  const { deps } = fakeDeps()
  const refused = await runCheck(httpRequest({ url: 'https://api.example.com/x' }), 'eu-central-1', deps)
  assertEquals([refused.status, refused.error], ['down', 'Connection refused.'])
  const unresolvable = await runCheck(httpRequest({ url: 'https://nope.example.com/' }), 'eu-central-1', deps)
  assertEquals([unresolvable.status, unresolvable.error], ['down', 'Could not resolve nope.example.com.'])
  const privateIp = await runCheck(httpRequest({ url: 'https://169.254.169.254/latest/meta-data' }), 'eu-central-1', deps)
  assertEquals([privateIp.status, privateIp.error], ['down', 'Private, local and reserved IP addresses are not allowed.'])

  const noKey = fakeDeps({ overrides: { secretsKey: undefined } })
  const withoutKey = await runCheck(httpRequest({ url: 'https://api.example.com/x' }, { secret_headers: 'v1.a.b' }), 'eu-central-1', noKey.deps)
  assertEquals(withoutKey.status, 'error')
  assertStringIncludes(withoutKey.error ?? '', 'UPVANE_SECRETS_KEY')
  const garbage = await runCheck(httpRequest({ url: 'https://api.example.com/x' }, { secret_headers: 'v1.a.b' }), 'eu-central-1', deps)
  assertEquals([garbage.status, garbage.error], ['error', 'The secret headers could not be decrypted. Save them again.'])
  const noDns = fakeDeps({ overrides: { lookup: null } })
  assertEquals((await runCheck(httpRequest({ url: 'https://api.example.com/x' }), 'eu-central-1', noDns.deps)).status, 'error')
})

Deno.test('http: the timeout covers the whole check', async () => {
  const { deps } = fakeDeps({
    routes: {
      'https://api.example.com/slow': () => new Promise<Response>(() => {
        // Never answers: only the abort signal can end it (see the fetch wrapper below).
      }),
    },
  })
  const slowFetch: typeof fetch = (input, init) =>
    new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      deps.fetch(input, init).then(resolve, reject)
    })
  const result = await runCheck(httpRequest({ url: 'https://api.example.com/slow' }, { timeout_ms: 50 }), 'eu-central-1', { ...deps, fetch: slowFetch })
  assertEquals([result.status, result.error], ['down', 'Timed out after 50 ms.'])
})

Deno.test('tcp: connects to the validated address, degrades when slow and reports refusals', async () => {
  const connected: string[] = []
  const { deps } = fakeDeps({
    dns: { 'db.example.com': ['2606:4700::6810:84e5', '104.16.132.229'] },
    tick: 300,
    overrides: {
      connectTcp: async (address, port) => {
        connected.push(`${address}:${port}`)
      },
    },
  })
  const tcp = (config: Record<string, unknown>): ProbeRequest => ({ monitor_id: 'm2', type: 'tcp', config, timeout_ms: 5000, secret_headers: null })
  const up = await runCheck(tcp({ host: 'db.example.com', port: 5432 }), 'eu-central-1', deps)
  assertEquals([up.status, up.latency_ms, connected[0]], ['up', 300, '104.16.132.229:5432'])
  const slow = await runCheck(tcp({ host: 'db.example.com', port: 5432, latency_threshold_ms: 100 }), 'eu-central-1', deps)
  assertEquals([slow.status, slow.error], ['degraded', 'Connected in 300 ms, slower than 100 ms.'])
  const refused = fakeDeps({ overrides: { connectTcp: () => Promise.reject(Object.assign(new Error('Connection refused (os error 111)'), { name: 'ConnectionRefused' })) } })
  assertEquals((await runCheck(tcp({ host: 'api.example.com', port: 5432 }), 'eu-central-1', refused.deps)).error, 'Connection refused.')
  assertEquals((await runCheck(tcp({ host: '127.0.0.1', port: 5432 }), 'eu-central-1', deps)).status, 'down')
  assertEquals((await runCheck(tcp({ host: 'db.example.com', port: 0 }), 'eu-central-1', deps)).status, 'error')
})

Deno.test('dns: formats records and compares them with the expected values', async () => {
  const records: Record<string, unknown[]> = {
    'TXT example.com': [['v=spf1 include:_spf.example.com', ' ~all']],
    'MX example.com': [{ preference: 10, exchange: 'mx1.example.com.' }],
  }
  const { deps } = fakeDeps({
    overrides: {
      lookup: async (hostname, type) => {
        const answer = records[`${type} ${hostname}`]
        if (!answer) throw notFound()
        return answer
      },
    },
  })
  const dns = (config: Record<string, unknown>): ProbeRequest => ({ monitor_id: 'm3', type: 'dns', config, timeout_ms: 5000, secret_headers: null })
  const spf = await runCheck(dns({ hostname: 'example.com', record_type: 'TXT', expected_values: ['v=spf1 include:_spf.example.com ~all'] }), 'eu-central-1', deps)
  assertEquals([spf.status, spf.details?.answers], ['up', ['v=spf1 include:_spf.example.com ~all']])
  const mx = await runCheck(dns({ hostname: 'example.com', record_type: 'mx', expected_values: ['mx2.example.com'] }), 'eu-central-1', deps)
  assertEquals([mx.status, mx.error], ['down', 'Expected one of mx2.example.com, got 10 mx1.example.com, mx1.example.com.'])
  const missing = await runCheck(dns({ hostname: 'example.com', record_type: 'CAA' }), 'eu-central-1', deps)
  assertEquals([missing.status, missing.error], ['down', 'No CAA records found for example.com.'])
  const internal = await runCheck(dns({ hostname: 'db.internal' }), 'eu-central-1', deps)
  assertEquals(internal.status, 'down')
})

Deno.test('tls: expiry, warning window and untrusted chains', async () => {
  const peer = (overrides: Partial<TlsPeer>): TlsPeer => ({
    validFrom: new Date('2026-09-01T00:00:00Z'),
    validTo: new Date('2027-01-01T00:00:00Z'),
    authorized: true,
    authorizationError: null,
    subject: 'api.example.com',
    issuer: "Let's Encrypt",
    protocol: 'TLSv1.3',
    ...overrides,
  })
  let next = peer({})
  let seen: { address: string; servername: string | null } | null = null
  const { deps } = fakeDeps({
    overrides: {
      tlsHandshake: async (input) => {
        seen = { address: input.address, servername: input.servername }
        return next
      },
    },
  })
  const tls = (config: Record<string, unknown>): ProbeRequest => ({ monitor_id: 'm4', type: 'tls', config, timeout_ms: 5000, secret_headers: null })

  const fine = await runCheck(tls({ hostname: 'api.example.com', warn_days: 21 }), 'eu-central-1', deps)
  assertEquals([fine.status, fine.tls_expires_at, fine.details?.days_left], ['up', '2027-01-01T00:00:00.000Z', 83])
  assertEquals(seen, { address: '93.184.216.34', servername: 'api.example.com' })

  next = peer({ validTo: new Date('2026-10-19T00:00:00Z') })
  const soon = await runCheck(tls({ hostname: 'api.example.com', warn_days: 21 }), 'eu-central-1', deps)
  assertEquals([soon.status, soon.error], ['degraded', 'The certificate expires in 9 days (2026-10-19).'])

  next = peer({ validTo: new Date('2026-10-01T00:00:00Z'), authorized: false, authorizationError: 'CERT_HAS_EXPIRED' })
  const expired = await runCheck(tls({ hostname: 'api.example.com' }), 'eu-central-1', deps)
  assertEquals([expired.status, expired.error, expired.tls_expires_at], ['down', 'The certificate expired on 2026-10-01.', '2026-10-01T00:00:00.000Z'])

  next = peer({ authorized: false, authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })
  const untrusted = await runCheck(tls({ hostname: 'api.example.com' }), 'eu-central-1', deps)
  assertEquals(untrusted.status, 'down')
  assertStringIncludes(untrusted.error ?? '', 'intermediate certificates')
  assert(untrusted.tls_expires_at)

  next = peer({ validTo: null })
  assertEquals((await runCheck(tls({ hostname: 'api.example.com' }), 'eu-central-1', deps)).error, 'The server did not present a certificate.')
})
