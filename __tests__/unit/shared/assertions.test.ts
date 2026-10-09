import { describe, expect, it } from 'vitest'
import { evaluateDnsAnswers, evaluateHttpResponse, evaluateTlsExpiry, readJsonPath, statusMatches } from '@shared/monitoring/assertions.ts'

const response = (overrides: Partial<{ status: number; headers: Record<string, string>; bodyText: string | null; latencyMs: number }> = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/json', 'x-version': '42' },
  bodyText: JSON.stringify({ status: 'ok', checks: [{ name: 'db', ok: true }], queue: { depth: 12 } }),
  latencyMs: 120,
  ...overrides,
})

describe('statusMatches', () => {
  it('supports codes, families and ranges, defaulting to 200-399', () => {
    expect(statusMatches(204, undefined)).toBe(true)
    expect(statusMatches(302, [])).toBe(true)
    expect(statusMatches(404, undefined)).toBe(false)
    expect(statusMatches(201, ['2xx'])).toBe(true)
    expect(statusMatches(418, [418])).toBe(true)
    expect(statusMatches(503, ['200-299', '503'])).toBe(true)
    expect(statusMatches(500, ['bogus'])).toBe(false)
  })
})

describe('readJsonPath', () => {
  const doc = { a: { b: [{ c: 1 }, { c: 2 }] }, 'x y': true }
  it('reads dotted, indexed and quoted paths', () => {
    expect(readJsonPath(doc, 'a.b[1].c')).toBe(2)
    expect(readJsonPath(doc, '$.a.b.0.c')).toBe(1)
    expect(readJsonPath(doc, '["x y"]')).toBe(true)
    expect(readJsonPath(doc, 'a.missing')).toBeUndefined()
    expect(readJsonPath(doc, 'a.b[9]')).toBeUndefined()
  })
})

describe('evaluateHttpResponse', () => {
  it('is up when every expectation holds', () => {
    const outcome = evaluateHttpResponse({ assertions: [{ source: 'json', path: 'status', operator: 'equals', value: 'ok' }] }, response())
    expect(outcome).toEqual({ status: 'up', error: null, failures: [] })
  })

  it('is down on an unexpected status code, with a readable reason', () => {
    const outcome = evaluateHttpResponse({ expected_status_codes: ['200-299'] }, response({ status: 503 }))
    expect(outcome.status).toBe('down')
    expect(outcome.error).toBe('Status 503 is not 200-299.')
  })

  it('applies on_fail per assertion and keeps the worst result', () => {
    const outcome = evaluateHttpResponse(
      {
        assertions: [
          { source: 'json', path: 'queue.depth', operator: 'less_than', value: 10, on_fail: 'degraded' },
          { source: 'header', path: 'X-Version', operator: 'equals', value: '42' },
        ],
      },
      response(),
    )
    expect(outcome.status).toBe('degraded')
    expect(outcome.failures).toEqual(['JSON queue.depth expected to be less than 10, got 12.'])
  })

  it('checks every array element with contains', () => {
    const outcome = evaluateHttpResponse({ assertions: [{ source: 'json', path: 'checks[0].ok', operator: 'equals', value: true }] }, response())
    expect(outcome.status).toBe('up')
  })

  it('treats a non-JSON body as missing values', () => {
    const outcome = evaluateHttpResponse({ assertions: [{ source: 'json', path: 'status', operator: 'exists' }] }, response({ bodyText: '<html>' }))
    expect(outcome.status).toBe('down')
  })

  it('degrades slow responses without hiding failures', () => {
    expect(evaluateHttpResponse({ latency_threshold_ms: 100 }, response({ latencyMs: 450 })).status).toBe('degraded')
    expect(evaluateHttpResponse({ latency_threshold_ms: 100 }, response({ latencyMs: 450, status: 500 })).status).toBe('down')
  })

  it('checks keywords, case-insensitive by default', () => {
    expect(evaluateHttpResponse({ keyword: 'OK' }, response(), { keywordCheck: true }).status).toBe('up')
    expect(evaluateHttpResponse({ keyword: 'OK', case_sensitive: true }, response(), { keywordCheck: true }).status).toBe('down')
    expect(evaluateHttpResponse({ keyword: 'error', keyword_mode: 'not_contains' }, response(), { keywordCheck: true }).status).toBe('up')
  })
})

describe('evaluateDnsAnswers', () => {
  it('matches any or all expected values, ignoring case and trailing dots', () => {
    expect(evaluateDnsAnswers(['1.1.1.1', '1.0.0.1'], ['1.1.1.1']).status).toBe('up')
    expect(evaluateDnsAnswers(['Mail.Example.com.'], ['mail.example.com'], 'all').status).toBe('up')
    expect(evaluateDnsAnswers(['1.1.1.1'], ['1.1.1.1', '1.0.0.1'], 'all').status).toBe('down')
    expect(evaluateDnsAnswers([], undefined).status).toBe('down')
  })
})

describe('evaluateTlsExpiry', () => {
  const now = new Date('2026-10-09T00:00:00Z')
  it('is degraded inside the warning window and down once expired', () => {
    expect(evaluateTlsExpiry(new Date('2027-01-01T00:00:00Z'), now, 14).status).toBe('up')
    expect(evaluateTlsExpiry(new Date('2026-10-15T00:00:00Z'), now, 14).status).toBe('degraded')
    expect(evaluateTlsExpiry(new Date('2026-10-01T00:00:00Z'), now, 14).status).toBe('down')
  })
})
