// PagerDuty Events API v2 and Opsgenie Alert API. Problems trigger, recoveries and resolved incidents resolve the
// same dedup key, so the on-call tool closes the page on its own.
import type { AlertMessage, OutboundRequest } from '../types.ts'

const PAGEABLE = new Set([
  'component_status_worsened',
  'component_recovered',
  'monitor_down',
  'monitor_degraded',
  'monitor_recovered',
  'tls_expiring',
  'incident_created',
  'incident_updated',
  'incident_resolved',
  'incident_draft_created',
  'test',
])

export function isPageable(eventType: string): boolean {
  return PAGEABLE.has(eventType)
}

export function buildPagerDutyRequest(message: AlertMessage, routingKey: string): OutboundRequest {
  const resolve = message.isResolution
  const body = resolve
    ? { routing_key: routingKey, event_action: 'resolve', dedup_key: message.dedupKey }
    : {
        routing_key: routingKey,
        event_action: 'trigger',
        dedup_key: message.dedupKey,
        payload: {
          summary: message.title.slice(0, 1024),
          source: message.projectName,
          severity: message.severity,
          timestamp: message.occurredAt,
          component: message.fields.find((field) => field.label === 'Components')?.value,
          group: message.projectName,
          class: message.eventType,
          custom_details: Object.fromEntries([['summary', message.summary], ...message.fields.map((field) => [field.label, field.value])]),
        },
        links: [
          ...(message.dashboardUrl ? [{ href: message.dashboardUrl, text: message.dashboardLabel }] : []),
          ...(message.statusPageUrl ? [{ href: message.statusPageUrl, text: 'Status page' }] : []),
        ],
        client: 'Upvane',
        client_url: message.dashboardUrl ?? undefined,
      }
  return {
    url: 'https://events.pagerduty.com/v2/enqueue',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

const OPSGENIE_PRIORITY: Record<AlertMessage['severity'], string> = { critical: 'P1', error: 'P2', warning: 'P3', info: 'P5' }

export function buildOpsgenieRequest(message: AlertMessage, apiKey: string, region: 'us' | 'eu' = 'us'): OutboundRequest {
  const host = region === 'eu' ? 'https://api.eu.opsgenie.com' : 'https://api.opsgenie.com'
  const alias = message.dedupKey.slice(0, 512)
  if (message.isResolution) {
    return {
      url: `${host}/v2/alerts/${encodeURIComponent(alias)}/close?identifierType=alias`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `GenieKey ${apiKey}` },
      body: JSON.stringify({ source: 'Upvane', note: message.title.slice(0, 25000) }),
    }
  }
  return {
    url: `${host}/v2/alerts`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `GenieKey ${apiKey}` },
    body: JSON.stringify({
      message: message.title.slice(0, 130),
      alias,
      description: [message.summary, ...message.fields.map((field) => `${field.label}: ${field.value}`), message.dashboardUrl ?? ''].filter(Boolean).join('\n').slice(0, 15000),
      priority: OPSGENIE_PRIORITY[message.severity],
      source: 'Upvane',
      entity: message.projectName.slice(0, 512),
      tags: ['upvane', message.eventType],
      details: Object.fromEntries(message.fields.map((field) => [field.label.slice(0, 50), field.value.slice(0, 500)])),
    }),
  }
}
