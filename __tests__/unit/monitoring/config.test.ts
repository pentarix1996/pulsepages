import { describe, expect, it } from 'vitest'
import { canUseAutomaticMonitoring, normalizeMonitorConfig } from '@/lib/monitoring/config'

describe('canUseAutomaticMonitoring', () => {
  it('blocks automatic monitoring for free plan', () => {
    expect(canUseAutomaticMonitoring('free')).toBe(false)
    expect(canUseAutomaticMonitoring('pro')).toBe(true)
    expect(canUseAutomaticMonitoring('business')).toBe(true)
  })
})

describe('normalizeMonitorConfig', () => {
  it('enforces manual mode defaults', () => {
    const config = normalizeMonitorConfig({ mode: 'manual', component_id: 'component-1' }, 'free')

    expect(config.mode).toBe('manual')
    expect(config.enabled).toBe(false)
    expect(config.url).toBeNull()
  })

  it('enforces the 60 second interval floor for paid plans', () => {
    const config = normalizeMonitorConfig(
      { mode: 'automatic', component_id: 'component-1', url: 'https://example.com/health', interval_seconds: 15 },
      'business'
    )

    expect(config.interval_seconds).toBe(60)
  })

  it('caps timeout and normalizes expected status codes', () => {
    const config = normalizeMonitorConfig(
      { mode: 'automatic', component_id: 'component-1', url: 'https://example.com/health', timeout_ms: 60000, expected_status_codes: [200, 204, 999] },
      'pro'
    )

    expect(config.timeout_ms).toBe(10000)
    expect(config.expected_status_codes).toEqual([200, 204])
  })
})
