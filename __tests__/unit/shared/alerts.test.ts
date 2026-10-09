// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildAlertMessage, statusPageUrl } from '@shared/alerts/message.ts'
import { classifyHttpStatus, nextRetryAt, prepareDelivery } from '@shared/alerts/dispatch.ts'
import { validateChatWebhookUrl } from '@shared/alerts/targets.ts'
import { bytesToBase64, encryptJson } from '@shared/crypto.ts'
import type { AlertEventRow, DeliveryContext, ProjectContext } from '@shared/alerts/types.ts'

const key = bytesToBase64(new Uint8Array(32).fill(3))
const project: ProjectContext = { id: 'p1', name: 'Quillbase', slug: 'status', organization_slug: 'quill', brand_color: '#0E7490', logo_url: null, custom_domain: null }
const links = { appUrl: 'https://app.upvane.dev' }

const event = (type: string, payload: Record<string, unknown>, extra: Partial<AlertEventRow> = {}): AlertEventRow => ({
  id: 'e1',
  project_id: 'p1',
  type,
  source_type: 'monitor',
  source_id: 's1',
  severity: null,
  dedupe_key: null,
  payload,
  audience: 'team',
  created_at: '2026-10-09T10:00:00Z',
  ...extra,
})

const monitorDown = event('monitor_down', {
  project_name: 'Quillbase',
  reason: 'Payments API is down: Status 503 is not 200-399.',
  dashboard_path: '/p/p1/monitors/m1',
  monitor: { id: 'm1', name: 'Payments API', type: 'http', target: 'GET https://api.quill.io/health', last_error: 'Status 503 is not 200-399.', last_result: { regions: { 'eu-central-1': 'down', 'us-east-1': 'down' } } },
  components: [{ id: 'c1', name: 'API' }],
  draft_incident_path: '/p/p1/incidents/i9',
})

describe('buildAlertMessage', () => {
  it('describes monitor failures with regions, components and the draft incident', () => {
    const message = buildAlertMessage(monitorDown, project, links)
    expect(message.title).toBe('Payments API is down')
    expect(message.tone).toBe('problem')
    expect(message.severity).toBe('critical')
    expect(message.dashboardUrl).toBe('https://app.upvane.dev/p/p1/incidents/i9')
    expect(message.dashboardLabel).toBe('Review the draft incident')
    expect(message.fields.find((field) => field.label === 'Regions')?.value).toBe('Frankfurt down, N. Virginia down')
    expect(message.dedupKey).toBe('upvane:p1:monitor:m1')
  })

  it('pairs recoveries with the same dedup key', () => {
    const recovered = buildAlertMessage(event('monitor_recovered', { monitor: { id: 'm1', name: 'Payments API' } }), project, links)
    expect(recovered.isResolution).toBe(true)
    expect(recovered.dedupKey).toBe('upvane:p1:monitor:m1')
  })

  it('links incidents to the public page, honouring custom domains', () => {
    const payload = { incident: { id: 'i1', title: 'Failed payments', status: 'identified', impact: 'major', components: [{ id: 'c1', name: 'API', status: 'partial_outage' }] }, status_page_path: '/status/quill/status/incidents/i1', message: 'Cause found.' }
    const message = buildAlertMessage(event('incident_updated', payload), project, links)
    expect(message.title).toBe('Incident update: Failed payments')
    expect(message.statusPageUrl).toBe('https://app.upvane.dev/status/quill/status/incidents/i1')
    expect(message.fields).toContainEqual({ label: 'Components', value: 'API (partial outage)' })
    const custom = buildAlertMessage(event('incident_updated', payload), { ...project, custom_domain: 'status.quill.io' }, links)
    expect(custom.statusPageUrl).toBe('https://status.quill.io/incidents/i1')
    expect(statusPageUrl({ ...project, custom_domain: null }, links)).toBe('https://app.upvane.dev/status/quill/status')
  })
})

const baseContext = (overrides: Partial<DeliveryContext>): DeliveryContext => ({
  delivery: { id: 'd1', event_id: 'e1', channel_id: 'ch1', subscriber_id: null, target: 'oncall@quill.io', target_type: 'email', status: 'processing', attempts: 1, next_retry_at: null },
  event: monitorDown,
  channel: { id: 'ch1', type: 'email', name: 'Team', enabled: true, config: {}, secret_encrypted: null },
  subscriber: null,
  project,
  ...overrides,
})

const deps = {
  links,
  decrypt: async (payload: string) => (await import('@shared/crypto.ts')).decryptSecret(payload, key),
  unsubscribeUrl: async () => 'https://app.upvane.dev/subscriptions/unsubscribe?token=t',
  resolve: async () => ['93.184.216.34'],
}

describe('prepareDelivery', () => {
  it('renders team emails', async () => {
    const prepared = await prepareDelivery(baseContext({}), deps)
    expect(prepared.kind).toBe('email')
    if (prepared.kind === 'email') {
      expect(prepared.email.to).toBe('oncall@quill.io')
      expect(prepared.email.subject).toBe('[Quillbase] Payments API is down')
      expect(prepared.email.html).toContain('Review the draft incident')
      expect(prepared.email.text).toContain('Status 503')
    }
  })

  it('signs generic webhooks and re-checks the target', async () => {
    const secret = await encryptJson({ url: 'https://hooks.quill.io/upvane', signing_secret: 'whsec_x' }, key)
    const prepared = await prepareDelivery(baseContext({ channel: { id: 'ch1', type: 'webhook', name: 'Hook', enabled: true, config: {}, secret_encrypted: secret } }), deps)
    expect(prepared.kind).toBe('http')
    if (prepared.kind === 'http') {
      expect(prepared.request.headers['Upvane-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
      expect(JSON.parse(prepared.request.body)).toMatchObject({ type: 'monitor_down', summary: { title: 'Payments API is down' } })
    }
    const internal = await prepareDelivery(baseContext({ channel: { id: 'ch1', type: 'webhook', name: 'Hook', enabled: true, config: {}, secret_encrypted: secret } }), { ...deps, resolve: async () => ['10.0.0.5'] })
    expect(internal).toMatchObject({ kind: 'skip', code: 'invalid_target' })
  })

  it('sends PagerDuty triggers and skips events that should not page', async () => {
    const secret = await encryptJson({ routing_key: 'R'.repeat(32) }, key)
    const channel = { id: 'ch1', type: 'pagerduty' as const, name: 'PD', enabled: true, config: {}, secret_encrypted: secret }
    const prepared = await prepareDelivery(baseContext({ channel }), deps)
    expect(prepared.kind === 'http' && JSON.parse(prepared.request.body)).toMatchObject({ event_action: 'trigger', dedup_key: 'upvane:p1:monitor:m1', payload: { severity: 'critical' } })
    const maintenance = await prepareDelivery(baseContext({ channel, event: event('maintenance_started', { maintenance: { id: 'mt', title: 'DB', status: 'in_progress', scheduled_start: '2026-10-09T10:00:00Z', scheduled_end: '2026-10-09T11:00:00Z' } }) }), deps)
    expect(maintenance).toMatchObject({ kind: 'skip', code: 'not_pageable' })
  })

  it('strips internal fields for subscriber webhooks and skips unconfirmed subscribers', async () => {
    const target = await encryptJson({ url: 'https://example.org/hook' }, key)
    const incident = event('incident_created', { dashboard_path: '/p/p1/incidents/i1', incident: { id: 'i1', title: 'Outage', status: 'investigating', impact: 'major' } }, { audience: 'subscribers' })
    const subscriber = { id: 's1', type: 'webhook' as const, email: null, target_encrypted: target, confirmed: true }
    const prepared = await prepareDelivery(baseContext({ channel: null, subscriber, event: incident }), deps)
    expect(prepared.kind).toBe('http')
    if (prepared.kind === 'http') {
      const body = JSON.parse(prepared.request.body)
      expect(body.data.dashboard_path).toBeUndefined()
      expect(body.summary.dashboard_url).toBeNull()
    }
    expect(await prepareDelivery(baseContext({ channel: null, subscriber: { ...subscriber, confirmed: false }, event: incident }), deps)).toMatchObject({ kind: 'skip', code: 'unconfirmed' })
  })
})

describe('targets and retries', () => {
  it('pins chat webhooks to their providers', () => {
    expect(validateChatWebhookUrl('slack', 'https://hooks.slack.com/services/T/B/X').ok).toBe(true)
    expect(validateChatWebhookUrl('slack', 'https://evil.example.com/services/T/B/X').ok).toBe(false)
    expect(validateChatWebhookUrl('discord', 'https://discord.com/api/webhooks/1/abc').ok).toBe(true)
    expect(validateChatWebhookUrl('teams', 'https://prod-01.westeurope.logic.azure.com/workflows/x').ok).toBe(true)
  })

  it('classifies responses and backs off', () => {
    expect(classifyHttpStatus(204)).toBe('sent')
    expect(classifyHttpStatus(429)).toBe('retryable')
    expect(classifyHttpStatus(503)).toBe('retryable')
    expect(classifyHttpStatus(404)).toBe('failed')
    const now = new Date('2026-10-09T00:00:00Z')
    expect(nextRetryAt(1, now).toISOString()).toBe('2026-10-09T00:01:00.000Z')
    expect(nextRetryAt(9, now).toISOString()).toBe('2026-10-09T06:00:00.000Z')
    expect(nextRetryAt(1, now, 600).toISOString()).toBe('2026-10-09T00:10:00.000Z')
  })
})
