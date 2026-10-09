// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { evaluateDnsAnswers } from '@shared/monitoring/assertions.ts'
import {
  buildRequestHeaders,
  clampTimeout,
  describeNetworkError,
  describeTlsAuthorizationError,
  formatDnsAnswers,
  headersForRedirect,
  headersToRecord,
  needsResponseBody,
  parseCertificateDate,
  parseProbeRequest,
  preferIPv4,
  PROBE_USER_AGENT,
  redirectMethod,
  resolveRedirectUrl,
  sameOrigin,
} from '@shared/monitoring/probe.ts'

// Deno's fetch rejects with TypeError('fetch failed') and puts the detail (with the URL) in `cause`.
const denoFetchError = (detail: string, url = 'https://api.example.com/health') =>
  new TypeError('fetch failed', { cause: new Error(`error sending request for url (${url}): client error (Connect): ${detail}`) })

describe('parseProbeRequest', () => {
  it('accepts the runner payload and clamps the timeout', () => {
    const parsed = parseProbeRequest({ monitor_id: 'm1', type: 'http', config: { url: 'https://a.example.com' }, timeout_ms: 99_999, secret_headers: null })
    expect(parsed).toEqual({ ok: true, request: { monitor_id: 'm1', type: 'http', config: { url: 'https://a.example.com' }, timeout_ms: 30_000, secret_headers: null } })
    expect(clampTimeout(10)).toBe(1000)
    expect(clampTimeout(undefined)).toBe(10_000)
  })

  it('rejects heartbeats, unknown types and malformed fields', () => {
    expect(parseProbeRequest({ type: 'heartbeat', config: {} })).toMatchObject({ ok: false, error: expect.stringContaining('Heartbeat') })
    expect(parseProbeRequest({ type: 'ping', config: {} })).toMatchObject({ ok: false, error: 'Unknown monitor type "ping".' })
    expect(parseProbeRequest({ type: 'tcp', config: 'host:5432' })).toMatchObject({ ok: false })
    expect(parseProbeRequest({ type: 'tcp', config: {}, secret_headers: 42 })).toMatchObject({ ok: false })
    expect(parseProbeRequest([])).toMatchObject({ ok: false })
  })
})

describe('buildRequestHeaders', () => {
  it('adds defaults and lets secret headers replace config headers with the same name', () => {
    const built = buildRequestHeaders([{ name: 'Authorization', value: 'Bearer public' }, { name: 'X-Env', value: 'prod' }], [{ name: 'authorization', value: 'Bearer secret' }])
    expect(built).toEqual({
      ok: true,
      secretNames: ['authorization'],
      headers: [
        ['X-Env', 'prod'],
        ['authorization', 'Bearer secret'],
        ['User-Agent', PROBE_USER_AGENT],
        ['Accept', '*/*'],
      ],
    })
  })

  it('drops headers the HTTP client manages and rejects header injection', () => {
    const built = buildRequestHeaders([{ name: 'Host', value: 'internal' }, { name: 'Content-Length', value: '5' }, { name: 'User-Agent', value: 'mine' }], [])
    expect(built.ok && built.headers).toEqual([
      ['User-Agent', 'mine'],
      ['Accept', '*/*'],
    ])
    expect(buildRequestHeaders([{ name: 'X-A', value: 'a\r\nX-B: b' }], [])).toMatchObject({ ok: false })
    expect(buildRequestHeaders([{ name: 'Bad Name', value: 'x' }], [])).toMatchObject({ ok: false })
  })

  it('sets a content type for request bodies', () => {
    const json = buildRequestHeaders([], [], '{"ping":true}')
    expect(json.ok && json.headers).toContainEqual(['Content-Type', 'application/json'])
    const text = buildRequestHeaders([], [], 'ping')
    expect(text.ok && text.headers).toContainEqual(['Content-Type', 'text/plain; charset=utf-8'])
  })
})

describe('redirects', () => {
  it('rewrites methods like the fetch spec', () => {
    expect(redirectMethod(303, 'POST')).toEqual({ method: 'GET', keepBody: false })
    expect(redirectMethod(302, 'POST')).toEqual({ method: 'GET', keepBody: false })
    expect(redirectMethod(307, 'POST')).toEqual({ method: 'POST', keepBody: true })
    expect(redirectMethod(301, 'put')).toEqual({ method: 'PUT', keepBody: true })
    expect(redirectMethod(303, 'HEAD')).toEqual({ method: 'HEAD', keepBody: false })
    expect(redirectMethod(301, 'GET')).toEqual({ method: 'GET', keepBody: false })
  })

  it('resolves relative locations and drops fragments', () => {
    expect(resolveRedirectUrl('https://a.example.com/x/y', '../z?q=1#top')).toBe('https://a.example.com/z?q=1')
    expect(resolveRedirectUrl('https://a.example.com/', 'https://b.example.com/login')).toBe('https://b.example.com/login')
    expect(resolveRedirectUrl('https://a.example.com/', '')).toBeNull()
    expect(resolveRedirectUrl('https://a.example.com/', 'http://[::1')).toBeNull()
    expect(sameOrigin('https://a.example.com/x', 'https://a.example.com/y')).toBe(true)
    expect(sameOrigin('https://a.example.com/x', 'https://a.example.com:8443/y')).toBe(false)
  })

  it('never forwards credentials or secret headers to another origin', () => {
    const headers: Array<[string, string]> = [
      ['Authorization', 'Bearer t'],
      ['Cookie', 'c=1'],
      ['X-Api-Key', 'k'],
      ['Content-Type', 'application/json'],
      ['Accept', '*/*'],
    ]
    expect(headersForRedirect(headers, ['x-api-key'], true, true)).toEqual(headers)
    expect(headersForRedirect(headers, ['x-api-key'], false, true)).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', '*/*'],
    ])
    expect(headersForRedirect(headers, [], true, false).map(([name]) => name)).toEqual(['Authorization', 'Cookie', 'X-Api-Key', 'Accept'])
  })
})

describe('response helpers', () => {
  it('knows when the body is needed', () => {
    expect(needsResponseBody('keyword', {})).toBe(true)
    expect(needsResponseBody('http', { assertions: [{ source: 'status_code', operator: 'equals', value: 200 }] })).toBe(false)
    expect(needsResponseBody('http', { assertions: [{ source: 'json', path: 'status', operator: 'equals', value: 'ok' }] })).toBe(true)
  })

  it('lower-cases and merges headers', () => {
    expect(headersToRecord([['Set-Cookie', 'a=1'], ['set-cookie', 'b=2'], ['X-Id', '7']])).toEqual({ 'set-cookie': 'a=1, b=2', 'x-id': '7' })
  })

  it('prefers IPv4 addresses', () => {
    expect(preferIPv4(['2606:4700::1', '104.20.23.154', '172.66.147.243'])).toEqual(['104.20.23.154', '172.66.147.243', '2606:4700::1'])
  })
})

describe('formatDnsAnswers', () => {
  it('flattens every record type into comparable strings', () => {
    expect(formatDnsAnswers('A', ['93.184.216.34', '93.184.216.34'])).toEqual(['93.184.216.34'])
    expect(formatDnsAnswers('TXT', [['v=spf1 include:_spf.example.com', ' ~all'], ['google-site-verification=abc']])).toEqual(['v=spf1 include:_spf.example.com ~all', 'google-site-verification=abc'])
    expect(formatDnsAnswers('MX', [{ preference: 10, exchange: 'mx1.example.com.' }])).toEqual(['10 mx1.example.com.', 'mx1.example.com.'])
    expect(formatDnsAnswers('CAA', [{ critical: false, tag: 'issue', value: 'letsencrypt.org' }])).toEqual(['0 issue "letsencrypt.org"', 'letsencrypt.org'])
  })

  it('lets users expect either the bare value or the full record', () => {
    const answers = formatDnsAnswers('MX', [{ preference: 10, exchange: 'mx1.example.com.' }, { preference: 20, exchange: 'mx2.example.com.' }])
    expect(evaluateDnsAnswers(answers, ['mx1.example.com', 'MX2.example.com.'], 'all').status).toBe('up')
    expect(evaluateDnsAnswers(answers, ['10 mx1.example.com'], 'any').status).toBe('up')
    expect(evaluateDnsAnswers(answers, ['mx3.example.com'], 'any').status).toBe('down')
  })
})

describe('certificates', () => {
  it('parses node:tls dates', () => {
    expect(parseCertificateDate('Nov  8 02:32:17 2026 GMT')?.toISOString()).toBe('2026-11-08T02:32:17.000Z')
    expect(parseCertificateDate('soon')).toBeNull()
    expect(parseCertificateDate(undefined)).toBeNull()
  })

  it('explains authorization errors', () => {
    expect(describeTlsAuthorizationError('DEPTH_ZERO_SELF_SIGNED_CERT', 'a.example.com')).toBe('The certificate is self-signed.')
    expect(describeTlsAuthorizationError('ERR_TLS_CERT_ALTNAME_INVALID', 'a.example.com')).toBe('The certificate is not valid for a.example.com.')
    expect(describeTlsAuthorizationError('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'a.example.com')).toContain('intermediate')
    expect(describeTlsAuthorizationError('WEIRD_CODE', 'a.example.com')).toBe('The certificate is not trusted (WEIRD_CODE).')
    expect(describeTlsAuthorizationError(null, 'a.example.com')).toBe('The certificate is not trusted.')
  })
})

describe('describeNetworkError', () => {
  it('reads the cause chain of Deno fetch errors', () => {
    expect(describeNetworkError(denoFetchError('tcp connect error: Connection refused (os error 111)'))).toBe('Connection refused.')
    expect(describeNetworkError(denoFetchError('dns error: failed to lookup address information: Name or service not known'), { hostname: 'api.example.com' })).toBe('Could not resolve api.example.com.')
    expect(describeNetworkError(denoFetchError('invalid peer certificate: UnknownIssuer'))).toBe('TLS error: the certificate was issued by an unknown authority.')
    expect(describeNetworkError(denoFetchError('invalid peer certificate: Expired'))).toBe('TLS error: the certificate has expired.')
    expect(describeNetworkError(denoFetchError('invalid peer certificate: NotValidForName'), { hostname: 'api.example.com' })).toBe('TLS error: the certificate is not valid for api.example.com.')
    expect(describeNetworkError(denoFetchError('invalid peer certificate: Other(OtherError(CaUsedAsEndEntity))'))).toBe('TLS error: the certificate is self-signed.')
    expect(describeNetworkError(denoFetchError('connection reset by peer'))).toBe('The connection was reset.')
  })

  it('ignores words that only appear in the URL', () => {
    expect(describeNetworkError(denoFetchError('tcp connect error: Connection timed out (os error 110)', 'https://tls.certificate.example.com/'))).toBe('The connection timed out.')
  })

  it('reports timeouts with the configured duration', () => {
    expect(describeNetworkError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'), { timeoutMs: 10_000 })).toBe('Timed out after 10 s.')
    expect(describeNetworkError(Object.assign(new Error('Connection timed out'), { name: 'TimedOut' }), { timeoutMs: 2500 })).toBe('Timed out after 2500 ms.')
  })

  it('falls back to the innermost message', () => {
    expect(describeNetworkError(new TypeError('fetch failed', { cause: new Error('something odd happened') }))).toBe('The request failed: something odd happened')
  })
})
