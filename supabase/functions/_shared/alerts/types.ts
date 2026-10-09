import type { AlertChannelType, AlertEventType, SubscriberType } from '../domain.ts'

/** Row of public.alert_events as returned by alert_worker_load_delivery(). */
export interface AlertEventRow {
  id: string
  project_id: string
  type: AlertEventType | string
  source_type: string
  source_id: string | null
  severity: string | null
  dedupe_key: string | null
  payload: AlertPayload
  audience: 'team' | 'subscribers'
  created_at: string
}

export interface AlertDeliveryRow {
  id: string
  event_id: string
  channel_id: string | null
  subscriber_id: string | null
  target: string
  target_type: string
  status: string
  attempts: number
  next_retry_at: string | null
}

export interface ChannelContext {
  id: string
  type: AlertChannelType
  name: string
  enabled: boolean
  config: Record<string, unknown>
  secret_encrypted: string | null
}

export interface SubscriberContext {
  id: string
  type: SubscriberType
  email: string | null
  target_encrypted: string | null
  confirmed: boolean
}

export interface ProjectContext {
  id: string
  name: string
  slug: string
  organization_slug: string
  brand_color: string | null
  logo_url: string | null
  custom_domain: string | null
}

/** Result of SQL alert_worker_load_delivery(). */
export interface DeliveryContext {
  delivery: AlertDeliveryRow
  event: AlertEventRow
  channel: ChannelContext | null
  subscriber: SubscriberContext | null
  project: ProjectContext
}

export interface ComponentRef {
  id: string
  name: string
  slug?: string
  status?: string
}

/** Union of the payloads built by the SQL emitters; every field is optional so templates stay defensive. */
export interface AlertPayload {
  project_id?: string
  project_name?: string
  event_type?: string
  status?: string
  severity?: string
  reason?: string
  message?: string | null
  occurred_at?: string
  dashboard_path?: string
  status_page_path?: string
  change_reason?: string
  channel_id?: string
  component?: ComponentRef & { previous_status?: string; current_status?: string; source?: string }
  components?: ComponentRef[]
  monitor?: {
    id: string
    name: string
    type?: string
    target?: string
    state?: string
    previous_state?: string
    last_error?: string | null
    last_result?: Record<string, unknown> | null
    regions?: string[]
    tls_expires_at?: string
  }
  incident?: { id: string; title: string; status: string; impact: string; components?: ComponentRef[] }
  maintenance?: {
    id: string
    title: string
    description?: string
    status: string
    scheduled_start: string
    scheduled_end: string
    components?: ComponentRef[]
  }
  draft_incident_id?: string | null
  draft_incident_path?: string | null
  [key: string]: unknown
}

export type AlertTone = 'problem' | 'warning' | 'recovery' | 'info' | 'maintenance'

export interface AlertField {
  label: string
  value: string
}

/** Channel-neutral description of an event; every template renders from this. */
export interface AlertMessage {
  eventId: string
  eventType: string
  title: string
  summary: string
  tone: AlertTone
  color: string
  fields: AlertField[]
  projectName: string
  occurredAt: string
  dashboardUrl: string | null
  dashboardLabel: string
  statusPageUrl: string | null
  /** Groups related events for paging tools (trigger/resolve pairs). */
  dedupKey: string
  /** True when the event closes a problem (recoveries, resolved incidents, completed maintenance). */
  isResolution: boolean
  /** PagerDuty-style severity. */
  severity: 'critical' | 'error' | 'warning' | 'info'
}

export interface OutboundRequest {
  url: string
  method: 'POST' | 'PUT'
  headers: Record<string, string>
  body: string
}

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
}

export interface LinkContext {
  /** Public URL of the Next app, e.g. https://upvane.dev (no trailing slash). */
  appUrl: string
}
