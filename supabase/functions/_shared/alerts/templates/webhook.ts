// Generic JSON webhooks for teams (alert channels) and status page subscribers.
import type { AlertEventRow, AlertMessage, ProjectContext } from '../types.ts'

export const WEBHOOK_API_VERSION = '2026-10-01'
export const WEBHOOK_USER_AGENT = 'Upvane-Webhooks/1.0'

const INTERNAL_KEYS = new Set(['dashboard_path', 'draft_incident_id', 'draft_incident_path', 'change_reason', 'channel_id'])

/** Public payload for subscribers: no dashboard links, no internal fields. */
export function publicPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !INTERNAL_KEYS.has(key)))
}

export function buildWebhookBody(event: AlertEventRow, message: AlertMessage, project: ProjectContext, options: { audience: 'team' | 'subscribers'; statusPageUrl: string }): string {
  const isTeam = options.audience === 'team'
  return JSON.stringify({
    id: event.id,
    type: event.type,
    api_version: WEBHOOK_API_VERSION,
    created_at: event.created_at,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      organization_slug: project.organization_slug,
      status_page_url: options.statusPageUrl,
    },
    summary: {
      title: message.title,
      text: message.summary,
      tone: message.tone,
      severity: message.severity,
      is_resolution: message.isResolution,
      dashboard_url: isTeam ? message.dashboardUrl : null,
      status_page_url: message.statusPageUrl,
    },
    data: isTeam ? event.payload : publicPayload(event.payload as Record<string, unknown>),
  })
}
