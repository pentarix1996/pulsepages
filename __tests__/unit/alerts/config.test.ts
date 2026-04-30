import { describe, expect, it } from 'vitest'
import { normalizeEmailChannelConfig, normalizeProjectAlertConfig, normalizeRecipients } from '@/lib/alerts/config'

describe('alerts config validation', () => {
  it('normalizes recipient emails', () => {
    expect(normalizeRecipients([' OPS@UPVANE.COM ', 'dev@upvane.com'])).toEqual(['ops@upvane.com', 'dev@upvane.com'])
  })

  it('rejects invalid and duplicate recipients without returning partial state', () => {
    expect(() => normalizeRecipients(['ops@upvane.com', 'not-an-email'])).toThrow(/Invalid recipient/)
    expect(() => normalizeRecipients(['ops@upvane.com', 'OPS@upvane.com'])).toThrow(/Duplicate recipient/)
  })

  it('clamps cooldown and keeps alert toggles explicit', () => {
    const config = normalizeProjectAlertConfig({ enabled: true, cooldown_minutes: 9999, notify_recovery: false, alert_types: { incident_updated: false } })
    expect(config.cooldown_minutes).toBe(1440)
    expect(config.notify_recovery).toBe(false)
    expect(config.alert_types.incident_updated).toBe(false)
    expect(config.alert_types.component_status).toBe(true)
  })

  it('defaults incident lifecycle alerts off for new projects', () => {
    const config = normalizeProjectAlertConfig({})
    expect(config.alert_types.component_status).toBe(true)
    expect(config.alert_types.monitor_failure).toBe(true)
    expect(config.alert_types.incident_created).toBe(false)
    expect(config.alert_types.incident_updated).toBe(false)
    expect(config.alert_types.incident_resolved).toBe(false)
  })

  it('validates email channel config shape', () => {
    expect(normalizeEmailChannelConfig({ recipients: ['Founder@Upvane.com'] })).toEqual({ recipients: ['founder@upvane.com'], template_variant: 'default' })
  })
})
