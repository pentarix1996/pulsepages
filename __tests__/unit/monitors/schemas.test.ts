import { describe, expect, it } from 'vitest'
import { assertionInput, monitorCreateInput, monitorListQuery, monitorUpdateInput, statusCodePattern } from '@/lib/domain/schemas/monitors'

function issues(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  return (result.error?.issues ?? []).map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
}

describe('monitorCreateInput (discriminated union on type)', () => {
  it('parses an HTTP monitor with several assertions, headers and status patterns', () => {
    const parsed = monitorCreateInput.parse({
      type: 'http',
      name: '  Payments API  ',
      regions: ['eu-central-1', 'us-east-1'],
      components: ['payments-api'],
      config: {
        url: 'https://api.example.com/health#ignored',
        method: 'POST',
        body: '{"ping":true}',
        headers: [{ name: 'Accept', value: 'application/json' }],
        expected_status_codes: ['2XX', 204, '200 - 299', '301'],
        assertions: [
          { source: 'json', path: 'status', operator: 'equals', value: 'ok' },
          { source: 'json', path: 'queue.depth', operator: 'less_than', value: '1000', on_fail: 'degraded' },
          { source: 'header', path: 'content-type', operator: 'contains', value: 'json' },
          { source: 'body', operator: 'not_contains', value: 'error' },
        ],
        latency_threshold_ms: 800,
      },
      secret_headers: [{ name: 'Authorization', value: 'Bearer abc' }],
    })
    expect(parsed.type).toBe('http')
    expect(parsed.name).toBe('Payments API')
    if (parsed.type !== 'http') throw new Error('narrowing')
    expect(parsed.config.url).toBe('https://api.example.com/health')
    expect(parsed.config.expected_status_codes).toEqual(['2xx', 204, '200-299', 301])
    expect(parsed.config.follow_redirects).toBe(true)
    expect(parsed.config.assertions).toHaveLength(4)
    expect(parsed.config.assertions[1]).toEqual({ source: 'json', path: 'queue.depth', operator: 'less_than', value: 1000, on_fail: 'degraded' })
    expect(parsed.config.assertions[3]).toMatchObject({ source: 'body', path: null, operator: 'not_contains', value: 'error', on_fail: 'down' })
  })

  it('applies defaults per type', () => {
    const heartbeat = monitorCreateInput.parse({ type: 'heartbeat', name: 'Nightly backup' })
    expect(heartbeat.config).toEqual({ grace_seconds: 300 })
    const tls = monitorCreateInput.parse({ type: 'tls', name: 'Cert', config: { hostname: 'API.Example.com' } })
    expect(tls.config).toEqual({ hostname: 'api.example.com', port: 443, warn_days: 14 })
    const dns = monitorCreateInput.parse({ type: 'dns', name: 'MX', config: { hostname: '_dmarc.example.com', record_type: 'TXT' } })
    expect(dns.config).toEqual({ hostname: '_dmarc.example.com', record_type: 'TXT', expected_values: [], match: 'any' })
    const keyword = monitorCreateInput.parse({ type: 'keyword', name: 'Login', config: { url: 'https://app.example.com/login', keyword: 'Sign in' } })
    expect(keyword.config).toMatchObject({ method: 'GET', keyword_mode: 'contains', case_sensitive: false, headers: [], assertions: [] })
  })

  it('rejects an unknown type with a readable message', () => {
    expect(issues(monitorCreateInput.safeParse({ type: 'ftp', name: 'x' }))).toEqual(['type: Choose a monitor type: http, keyword, tcp, dns, tls, heartbeat.'])
  })

  it('rejects non-https, credentials and private literals in URLs (no DNS)', () => {
    const bad = (url: string) => issues(monitorCreateInput.safeParse({ type: 'http', name: 'x', config: { url } }))
    expect(bad('http://example.com')).toEqual(['config.url: Only https:// URLs can be monitored.'])
    expect(bad('https://user:pass@example.com')).toEqual(['config.url: Put credentials in a secret header, not in the URL.'])
    expect(bad('https://169.254.169.254/latest/meta-data')[0]).toMatch(/Private, local and reserved/)
    expect(bad('https://db.internal/')[0]).toMatch(/Local and internal hostnames/)
  })

  it('validates hosts, ports and keyword specifics', () => {
    expect(issues(monitorCreateInput.safeParse({ type: 'tcp', name: 'x', config: { host: 'db.example.com', port: 70000 } }))).toEqual(['config.port: Ports go from 1 to 65535.'])
    expect(issues(monitorCreateInput.safeParse({ type: 'tcp', name: 'x', config: { host: 'https://db.example.com', port: 5432 } }))[0]).toMatch(/only the hostname/)
    expect(issues(monitorCreateInput.safeParse({ type: 'tcp', name: 'x', config: { host: '10.1.2.3', port: 5432 } }))[0]).toMatch(/Private, local and reserved/)
    expect(issues(monitorCreateInput.safeParse({ type: 'keyword', name: 'x', config: { url: 'https://example.com', keyword: '' } }))).toContain('config.keyword: Enter the keyword to look for.')
    expect(issues(monitorCreateInput.safeParse({ type: 'keyword', name: 'x', config: { url: 'https://example.com', keyword: 'ok', method: 'HEAD' } }))).toContain('config.method: HEAD responses have no body. Use GET to look for a keyword.')
  })

  it('rejects bodies on GET, duplicate and reserved headers', () => {
    const result = monitorCreateInput.safeParse({
      type: 'http',
      name: 'x',
      config: { url: 'https://example.com', body: 'x', headers: [{ name: 'X-A', value: '1' }, { name: 'x-a', value: '2' }, { name: 'Host', value: 'evil' }] },
    })
    expect(issues(result)).toEqual(
      expect.arrayContaining([
        'config.headers.2.name: Upvane sets this header itself.',
        'config.body: GET requests cannot send a body. Use POST, PUT, PATCH, DELETE or OPTIONS.',
      ]),
    )
    expect(issues(monitorCreateInput.safeParse({ type: 'http', name: 'x', config: { url: 'https://example.com', headers: [{ name: 'X-A', value: '1' }, { name: 'x-a', value: '2' }] } }))).toContain('config.headers.1.name: x-a is set twice.')
    expect(issues(monitorCreateInput.safeParse({ type: 'http', name: 'x', config: { url: 'https://example.com', headers: [{ name: 'X-A', value: 'a\r\nInjected: 1' }] } }))).toContain('config.headers.0.value: Header values cannot contain line breaks.')
  })

  it('checks plan-independent ranges and regions', () => {
    const result = monitorCreateInput.safeParse({ type: 'http', name: 'x', interval_seconds: 10, regions: ['mars-1'], config: { url: 'https://example.com' } })
    expect(issues(result)).toEqual(expect.arrayContaining(['interval_seconds: Check at most every 30 seconds.', expect.stringMatching(/^regions\.0: Use probe regions/)]))
  })

  it('accepts secret headers with null values (keep the saved value) but not empty ones', () => {
    expect(monitorCreateInput.safeParse({ type: 'http', name: 'x', config: { url: 'https://example.com' }, secret_headers: [{ name: 'Authorization', value: null }] }).success).toBe(true)
    expect(issues(monitorCreateInput.safeParse({ type: 'http', name: 'x', config: { url: 'https://example.com' }, secret_headers: [{ name: 'Authorization', value: '  ' }] }))).toEqual(['secret_headers.0.value: Enter a value.'])
  })
})

describe('assertions', () => {
  it('requires a value and numbers where they matter', () => {
    expect(issues(assertionInput.safeParse({ source: 'json', path: 'a', operator: 'equals' }))).toEqual(['value: Enter a value to compare with.'])
    expect(issues(assertionInput.safeParse({ source: 'json', path: 'a', operator: 'greater_than', value: 'abc' }))).toEqual(['value: Use a number with this comparison.'])
    expect(issues(assertionInput.safeParse({ source: 'status_code', operator: 'equals', value: 'two hundred' }))).toEqual(['value: Use a number with this comparison.'])
    expect(issues(assertionInput.safeParse({ source: 'header', operator: 'exists' }))).toEqual(['path: Enter the header name.'])
    expect(issues(assertionInput.safeParse({ source: 'response_time', operator: 'exists' }))).toEqual(['operator: Compare the status code and the response time with a value.'])
  })

  it('normalises exists checks, json root paths and null comparisons', () => {
    expect(assertionInput.parse({ source: 'json', path: 'data.id', operator: 'exists', value: 'ignored' })).toEqual({ source: 'json', path: 'data.id', operator: 'exists', value: null, on_fail: 'down' })
    expect(assertionInput.parse({ source: 'json', operator: 'not_equals', value: null })).toMatchObject({ path: '$', value: null })
    expect(assertionInput.parse({ source: 'status_code', path: 'ignored', operator: 'less_than', value: '500' })).toMatchObject({ path: null, value: 500 })
  })
})

describe('statusCodePattern', () => {
  it('normalises codes, classes and ranges', () => {
    expect(statusCodePattern.parse('200')).toBe(200)
    expect(statusCodePattern.parse(' 3XX ')).toBe('3xx')
    expect(statusCodePattern.parse('200 - 299')).toBe('200-299')
  })
  it('rejects invalid patterns and inverted ranges', () => {
    expect(statusCodePattern.safeParse('6xx').success).toBe(false)
    expect(statusCodePattern.safeParse('299-200').success).toBe(false)
    expect(statusCodePattern.safeParse(99).success).toBe(false)
    expect(statusCodePattern.safeParse('ok').success).toBe(false)
  })
})

describe('update input and queries', () => {
  it('keeps config as raw input (validated by type in the domain)', () => {
    const parsed = monitorUpdateInput.parse({ enabled: false, config: { url: 'whatever' } })
    expect(parsed).toEqual({ enabled: false, config: { url: 'whatever' } })
    expect(monitorUpdateInput.parse({ secret_headers: null })).toEqual({ secret_headers: null })
  })

  it('reads comma-separated and repeated filters', () => {
    expect(monitorListQuery.parse({ state: 'down,degraded', type: ['http', 'tcp'] })).toMatchObject({ state: ['down', 'degraded'], type: ['http', 'tcp'] })
    expect(monitorListQuery.safeParse({ state: 'broken' }).success).toBe(false)
  })
})
