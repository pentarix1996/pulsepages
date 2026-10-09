// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ID, systemTestContext, userContext, type FakeCall, type FakeHandler, type Role } from '../monitors/fake-supabase'
import { alertmanagerWebhook, cloudwatchAlarm, snsSubscriptionConfirmation } from './fixtures'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(), createActorClient: vi.fn() }))
vi.mock('@/lib/domain/audit', () => ({ audit: vi.fn(async () => undefined) }))
vi.mock('@/lib/domain/cache', () => ({ invalidateStatusPage: vi.fn(), statusPageTag: vi.fn() }))

const { audit } = await import('@/lib/domain/audit')
const { createIntegration, listIntegrations, receiveInboundAlerts, updateIntegration } = await import('@/lib/domain/integrations')

const TOKEN = 'demo-inbound-token-alertmanager-0000000000'
const INTEGRATION_ID = 'dfcedb6e-e94e-42b3-88d6-48152bd61c70'
const API = '66666666-0000-4000-8000-000000000001'
const WEBHOOKS = '66666666-0000-4000-8000-000000000003'

const integrationRow = {
  id: INTEGRATION_ID,
  project_id: PROJECT_ID,
  type: 'alertmanager',
  name: 'Prometheus',
  token: TOKEN,
  enabled: true,
  mappings: [{ match: { service: 'payments' }, component_id: API, status: 'major_outage' }],
  default_component_id: null,
  default_status: 'partial_outage',
  auto_draft_incident: false,
  last_received_at: null,
  last_error: null,
  received_count: 3,
  created_by: null,
  created_at: '2026-10-01T00:00:00+00:00',
  updated_at: '2026-10-01T00:00:00+00:00',
}

function inboundHandler(overrides: { integration?: Record<string, unknown> | null; firing?: Array<{ external_id: string; component_id: string }> } = {}): FakeHandler {
  return (call) => {
    if (call.table === 'inbound_integrations' && call.action === 'select') {
      return { data: overrides.integration === undefined ? integrationRow : overrides.integration, error: null }
    }
    if (call.table === 'components') return { data: [{ id: API, slug: 'payments-api' }, { id: WEBHOOKS, slug: 'webhooks' }], error: null }
    if (call.table === 'component_signals') return { data: overrides.firing ?? [], error: null }
    if (call.table === 'rpc:ingest_signals') {
      const signals = (call.payload as { p_signals: Array<{ active: boolean }> }).p_signals
      return { data: { upserted: signals.filter((signal) => signal.active).length, resolved: signals.filter((signal) => !signal.active).length }, error: null }
    }
    return { data: null, error: null }
  }
}

const lastErrorUpdate = (calls: FakeCall[]) => calls.find((call) => call.table === 'inbound_integrations' && call.action === 'update')?.payload as { last_error?: string } | undefined

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.upvane.test'
  vi.mocked(audit).mockClear()
})

describe('receiveInboundAlerts', () => {
  it('maps alerts to signals and ingests them with the admin client', async () => {
    const { ctx, calls } = systemTestContext(inboundHandler())
    const result = await receiveInboundAlerts(ctx, TOKEN, { body: JSON.stringify(alertmanagerWebhook) })
    const ingest = calls.find((call) => call.table === 'rpc:ingest_signals')!
    expect(ingest.client).toBe('admin')
    expect((ingest.payload as { p_integration_id: string }).p_integration_id).toBe(INTEGRATION_ID)
    expect((ingest.payload as { p_signals: unknown[] }).p_signals).toEqual([
      expect.objectContaining({ external_id: 'c4d2bf2a9b1f8e3d', component_id: API, status: 'major_outage', active: true }),
    ])
    // The webhooks alert matched nothing (no default component) and the TargetDown alert's component does not exist
    expect(result).toEqual({ upserted: 1, resolved: 0, unmatched: 2 })
    expect(lastErrorUpdate(calls)?.last_error).toMatch(/^1 alert matched no component \(TargetDown\)/)
  })

  it('resolves signals of a resolved alert even when its mapping changed since it fired', async () => {
    const { ctx, calls } = systemTestContext(inboundHandler({ firing: [{ external_id: '8a1e2f3c4b5d6e7f', component_id: WEBHOOKS }] }))
    const result = await receiveInboundAlerts(ctx, TOKEN, { body: JSON.stringify(alertmanagerWebhook) })
    const signals = (calls.find((call) => call.table === 'rpc:ingest_signals')!.payload as { p_signals: Array<{ external_id: string; component_id: string; active: boolean }> }).p_signals
    expect(signals).toContainEqual(expect.objectContaining({ external_id: '8a1e2f3c4b5d6e7f', component_id: WEBHOOKS, active: false }))
    expect(result).toEqual({ upserted: 1, resolved: 1, unmatched: 1 })
  })

  it('answers 404 for unknown, disabled and malformed tokens', async () => {
    await expect(receiveInboundAlerts(systemTestContext(inboundHandler({ integration: null })).ctx, TOKEN, { body: '{}' })).rejects.toMatchObject({ code: 'not_found', status: 404 })
    await expect(receiveInboundAlerts(systemTestContext(inboundHandler({ integration: { ...integrationRow, enabled: false } })).ctx, TOKEN, { body: '{}' })).rejects.toMatchObject({ code: 'not_found' })
    const { ctx, calls } = systemTestContext(inboundHandler())
    await expect(receiveInboundAlerts(ctx, 'short', { body: '{}' })).rejects.toMatchObject({ code: 'not_found' })
    expect(calls).toHaveLength(0)
  })

  it('stores the parse error on the integration and answers 422', async () => {
    const { ctx, calls } = systemTestContext(inboundHandler())
    await expect(receiveInboundAlerts(ctx, TOKEN, { body: '{"hello":' })).rejects.toMatchObject({ code: 'invalid_request', status: 422, message: 'The payload is not valid JSON.' })
    expect(lastErrorUpdate(calls)).toMatchObject({ last_error: 'The payload is not valid JSON.' })

    const second = systemTestContext(inboundHandler())
    await expect(receiveInboundAlerts(second.ctx, TOKEN, { body: '{"hello":"world"}' })).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringMatching(/no alerts list/) })
    expect(lastErrorUpdate(second.calls)?.last_error).toMatch(/no alerts list/)
    expect(second.calls.some((call) => call.table === 'rpc:ingest_signals')).toBe(false)
  })

  it('confirms SNS subscriptions only on Amazon hosts', async () => {
    const cloudwatch = { ...integrationRow, type: 'cloudwatch', mappings: [], default_component_id: API }
    const fetcher = vi.fn(async () => new Response('<ConfirmSubscriptionResponse/>', { status: 200 }))
    const { ctx, calls } = systemTestContext(inboundHandler({ integration: cloudwatch }))
    await expect(receiveInboundAlerts(ctx, TOKEN, { body: JSON.stringify(snsSubscriptionConfirmation) }, fetcher)).resolves.toEqual({ upserted: 0, resolved: 0, unmatched: 0, subscription_confirmed: true })
    expect(fetcher).toHaveBeenCalledWith(snsSubscriptionConfirmation.SubscribeURL, expect.objectContaining({ method: 'GET', redirect: 'manual' }))
    expect(calls.find((call) => call.table === 'rpc:ingest_signals')?.payload).toEqual({ p_integration_id: INTEGRATION_ID, p_signals: [] })

    fetcher.mockClear()
    const evil = { ...snsSubscriptionConfirmation, SubscribeURL: 'https://attacker.example/?Action=ConfirmSubscription' }
    const other = systemTestContext(inboundHandler({ integration: cloudwatch }))
    await expect(receiveInboundAlerts(other.ctx, TOKEN, { body: JSON.stringify(evil) }, fetcher)).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringMatching(/not an Amazon SNS address/) })
    expect(fetcher).not.toHaveBeenCalled()

    // Alarms then flow to the default component
    const alarm = systemTestContext(inboundHandler({ integration: cloudwatch }))
    await expect(receiveInboundAlerts(alarm.ctx, TOKEN, { body: JSON.stringify(cloudwatchAlarm) })).resolves.toEqual({ upserted: 1, resolved: 0, unmatched: 0 })
  })
})

describe('integration management', () => {
  const crudHandler: FakeHandler = (call) => {
    if (call.table === 'inbound_integrations' && call.action === 'insert') return { data: { id: INTEGRATION_ID }, error: null }
    if (call.table === 'inbound_integrations') return { data: call.single ? integrationRow : [integrationRow], error: null }
    if (call.table === 'components') return { data: [{ id: API, slug: 'payments-api' }, { id: WEBHOOKS, slug: 'webhooks' }], error: null }
    if (call.table === 'component_signals') return { data: [{ integration_id: INTEGRATION_ID }, { integration_id: INTEGRATION_ID }], error: null }
    return { data: null, error: null }
  }

  it.each<Role>(['viewer', 'responder'])('hides integrations from a %s (their URLs hold secret tokens)', async (role) => {
    await expect(listIntegrations(userContext(role, crudHandler).ctx, PROJECT_ID)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('lists integrations for admins with their URL and firing alerts', async () => {
    const { integrations } = await listIntegrations(userContext('admin', crudHandler).ctx, PROJECT_ID)
    expect(integrations[0]).toMatchObject({ id: INTEGRATION_ID, url: `https://app.upvane.test/api/v1/inbound/${TOKEN}`, active_signals: 2, received_count: 3, mappings: [{ match: { service: 'payments' }, component_id: API, status: 'major_outage' }] })
  })

  it('resolves component keys in mappings and the default component', async () => {
    const { ctx, calls } = userContext('admin', crudHandler)
    await createIntegration(ctx, PROJECT_ID, {
      type: 'grafana',
      name: 'Grafana',
      default_component_id: 'webhooks',
      mappings: [{ match: { ' team ': ' payments ' }, component_id: 'payments-api', status: null }],
    })
    const insert = calls.find((call) => call.table === 'inbound_integrations' && call.action === 'insert')!
    expect(insert.payload).toMatchObject({ project_id: PROJECT_ID, type: 'grafana', default_component_id: WEBHOOKS, mappings: [{ match: { team: 'payments' }, component_id: API }] })
    expect(audit).toHaveBeenCalledWith(ctx, expect.objectContaining({ action: 'integration.created' }))
    await expect(createIntegration(ctx, PROJECT_ID, { type: 'generic', name: 'x', mappings: [{ match: { a: 'b' }, component_id: 'nope' }] })).rejects.toMatchObject({ details: [{ path: 'mappings.0.component_id' }] })
  })

  it('resolves firing alerts when an integration is disabled', async () => {
    const { ctx, calls } = userContext('admin', crudHandler)
    await updateIntegration(ctx, PROJECT_ID, INTEGRATION_ID, { enabled: false })
    const resolve = calls.find((call) => call.table === 'component_signals' && call.action === 'update')!
    expect(resolve.client).toBe('admin')
    expect(resolve.payload).toMatchObject({ active: false })
    expect(audit).toHaveBeenCalledWith(ctx, expect.objectContaining({ action: 'integration.disabled' }))
  })
})
