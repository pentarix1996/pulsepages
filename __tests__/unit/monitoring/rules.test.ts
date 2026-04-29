import { describe, expect, it } from 'vitest'
import { evaluateMonitorRules, getJsonPathValue } from '@/lib/monitoring/rules'

describe('getJsonPathValue', () => {
  it('reads safe dot and bracket paths without eval', () => {
    const payload = { status: { component: { db: 'ok' } }, services: [{ name: 'api' }] }

    expect(getJsonPathValue(payload, 'status.component.db')).toBe('ok')
    expect(getJsonPathValue(payload, 'services[0].name')).toBe('api')
  })

  it('blocks prototype paths', () => {
    expect(getJsonPathValue({ constructor: { prototype: true } }, 'constructor.prototype')).toBeUndefined()
    expect(getJsonPathValue({ __proto__: { polluted: true } }, '__proto__.polluted')).toBeUndefined()
  })
})

describe('evaluateMonitorRules', () => {
  it('returns the target status of the first matching rule', () => {
    const result = evaluateMonitorRules(
      { status: { component: { db: 'ok' } } },
      [
        { path: 'status.component.db', operator: 'equals', value: 'fail', targetStatus: 'major_outage' },
        { path: 'status.component.db', operator: 'equals', value: 'ok', targetStatus: 'operational' },
      ],
      'degraded'
    )

    expect(result.status).toBe('operational')
    expect(result.matchedRuleIndex).toBe(1)
  })

  it('compares string rule values case-insensitively', () => {
    const result = evaluateMonitorRules(
      { API: 'OK', DB: 'OK', redis: 'OK' },
      [{ path: 'API', operator: 'equals', value: 'ok', targetStatus: 'operational' }],
      'major_outage'
    )

    expect(result.status).toBe('operational')
    expect(result.matchedRuleIndex).toBe(0)
  })

  it('supports exists, contains, and numeric comparisons', () => {
    expect(evaluateMonitorRules({ ready: true }, [{ path: 'ready', operator: 'exists', targetStatus: 'operational' }], 'major_outage').status).toBe('operational')
    expect(evaluateMonitorRules({ mode: 'DEGRADED-cache' }, [{ path: 'mode', operator: 'contains', value: 'degraded', targetStatus: 'degraded' }], 'major_outage').status).toBe('degraded')
    expect(evaluateMonitorRules({ latency: 180 }, [{ path: 'latency', operator: 'less_than', value: 200, targetStatus: 'operational' }], 'major_outage').status).toBe('operational')
  })

  it('uses failure behavior when no rule matches', () => {
    const result = evaluateMonitorRules(
      { status: 'unknown' },
      [{ path: 'status', operator: 'equals', value: 'ok', targetStatus: 'operational' }],
      'partial_outage'
    )

    expect(result.status).toBe('partial_outage')
    expect(result.matchedRuleIndex).toBeNull()
  })
})
