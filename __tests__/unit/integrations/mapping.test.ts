import { describe, expect, it } from 'vitest'
import { mapAlertsToSignals, parseInboundPayload, severityToStatus, type InboundAlert, type MappingConfig } from '@/lib/domain/inbound'
import { alertmanagerWebhook, datadogTriggered, datadogWarn } from './fixtures'

const API = '66666666-0000-4000-8000-000000000001'
const WEBHOOKS = '66666666-0000-4000-8000-000000000003'
const DATABASE = '66666666-0000-4000-8000-000000000004'
const components = [
  { id: API, slug: 'payments-api' },
  { id: WEBHOOKS, slug: 'webhooks' },
  { id: DATABASE, slug: 'database' },
]

const alert = (overrides: Partial<InboundAlert>): InboundAlert => ({ external_id: 'x', active: true, labels: {}, summary: null, severity: null, ...overrides })

describe('severityToStatus', () => {
  it('maps common severity words and priorities', () => {
    expect(severityToStatus('critical')).toBe('major_outage')
    expect(severityToStatus(' P1 ')).toBe('major_outage')
    expect(severityToStatus('error')).toBe('partial_outage')
    expect(severityToStatus('high')).toBe('partial_outage')
    expect(severityToStatus('warning')).toBe('degraded')
    expect(severityToStatus('p4')).toBe('degraded')
    expect(severityToStatus('banana')).toBeNull()
    expect(severityToStatus(null)).toBeNull()
  })
})

describe('mapAlertsToSignals', () => {
  const config: MappingConfig = {
    mappings: [
      { match: { service: 'payments', severity: 'critical' }, component_id: API, status: 'major_outage' },
      { match: { service: 'webhooks' }, component_id: WEBHOOKS },
      { match: { service: 'gone' }, component_id: '00000000-0000-4000-8000-000000000000' },
    ],
    default_component_id: null,
    default_status: 'partial_outage',
  }

  it('applies mappings first, then the component label, then the default component', () => {
    const { signals, unmatched } = mapAlertsToSignals(alerts(parseInboundPayload('alertmanager', alertmanagerWebhook)), config, components)
    expect(signals).toEqual([
      expect.objectContaining({ external_id: 'c4d2bf2a9b1f8e3d', component_id: API, status: 'major_outage', active: true, summary: 'Payments API error rate above 5%' }),
      // mapping without status: the severity label decides (warning → degraded); resolved alerts keep their component
      expect.objectContaining({ external_id: '8a1e2f3c4b5d6e7f', component_id: WEBHOOKS, status: 'degraded', active: false }),
      // component label equal to a component key; no severity → default status
      expect.objectContaining({ component_id: DATABASE, status: 'partial_outage', active: true }),
    ])
    expect(unmatched).toEqual([])
  })

  it('needs every label of a mapping (case-insensitive values and keys)', () => {
    const { signals } = mapAlertsToSignals([alert({ labels: { Service: 'PAYMENTS', severity: 'critical' } }), alert({ external_id: 'y', labels: { service: 'payments', severity: 'warning' } })], config, components)
    expect(signals[0]).toMatchObject({ component_id: API, status: 'major_outage' })
    expect(signals).toHaveLength(1)
  })

  it('skips mappings to deleted components and falls back to the default', () => {
    const withDefault = { ...config, default_component_id: API }
    const { signals, unmatched } = mapAlertsToSignals([alert({ labels: { service: 'gone' }, severity: 'p2' })], withDefault, components)
    expect(signals).toEqual([expect.objectContaining({ component_id: API, status: 'partial_outage' })])
    expect(unmatched).toEqual([])
    expect(mapAlertsToSignals([alert({ labels: { service: 'gone' } })], config, components).unmatched).toHaveLength(1)
  })

  it('uses the explicit component and status of generic payloads', () => {
    const { signals } = mapAlertsToSignals([alert({ component: 'WEBHOOKS', status: 'degraded', severity: 'critical' }), alert({ external_id: 'id', component: DATABASE })], { ...config, mappings: [] }, components)
    expect(signals.map((signal) => [signal.component_id, signal.status])).toEqual([
      [WEBHOOKS, 'degraded'],
      [DATABASE, 'partial_outage'],
    ])
  })

  it('maps Datadog priorities and warnings', () => {
    const datadog = [...alerts(parseInboundPayload('datadog', datadogTriggered)), ...alerts(parseInboundPayload('datadog', datadogWarn))]
    const { signals } = mapAlertsToSignals(datadog, { mappings: [{ match: { service: 'api' }, component_id: API }], default_component_id: WEBHOOKS, default_status: 'partial_outage' }, components)
    expect(signals.map((signal) => [signal.component_id, signal.status])).toEqual([
      [API, 'major_outage'],
      [WEBHOOKS, 'degraded'],
    ])
  })
})

function alerts(payload: ReturnType<typeof parseInboundPayload>) {
  if (payload.kind !== 'alerts') throw new Error('expected alerts')
  return payload.alerts
}
