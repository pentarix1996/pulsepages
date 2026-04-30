import type { ComponentStatus } from '@/lib/types'

export const ALERT_CHANNEL_TYPE = {
  EMAIL: 'email',
} as const

export type AlertChannelType = (typeof ALERT_CHANNEL_TYPE)[keyof typeof ALERT_CHANNEL_TYPE]

export const ALERT_EVENT_TYPE = {
  COMPONENT_STATUS_WORSENED: 'component_status_worsened',
  COMPONENT_RECOVERED: 'component_recovered',
  MONITOR_CHECK_FAILED: 'monitor_check_failed',
  MONITOR_CHECK_RECOVERED: 'monitor_check_recovered',
  INCIDENT_CREATED: 'incident_created',
  INCIDENT_UPDATED: 'incident_updated',
  INCIDENT_RESOLVED: 'incident_resolved',
  TEST: 'test',
} as const

export type AlertEventType = (typeof ALERT_EVENT_TYPE)[keyof typeof ALERT_EVENT_TYPE]

export const ALERT_SOURCE_TYPE = {
  MANUAL: 'manual',
  INCIDENT: 'incident',
  MONITOR_NEXT_API: 'monitor_next_api',
  MONITOR_EDGE_RUNNER: 'monitor_edge_runner',
  EXTERNAL_API: 'external_api',
  TEST: 'test',
} as const

export type AlertSourceType = (typeof ALERT_SOURCE_TYPE)[keyof typeof ALERT_SOURCE_TYPE]

export const ALERT_EVENT_STATUS = {
  PENDING: 'pending',
  PROCESSED: 'processed',
  SUPPRESSED: 'suppressed',
  FAILED: 'failed',
} as const

export type AlertEventStatus = (typeof ALERT_EVENT_STATUS)[keyof typeof ALERT_EVENT_STATUS]

export const ALERT_DELIVERY_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  RETRYABLE: 'retryable',
  FAILED: 'failed',
  SUPPRESSED: 'suppressed',
} as const

export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUS)[keyof typeof ALERT_DELIVERY_STATUS]

export const ALERT_TYPE_CONFIG_KEYS = {
  COMPONENT_STATUS: 'component_status',
  MONITOR_FAILURE: 'monitor_failure',
  INCIDENT_CREATED: 'incident_created',
  INCIDENT_UPDATED: 'incident_updated',
  INCIDENT_RESOLVED: 'incident_resolved',
} as const

export type AlertTypeConfigKey = (typeof ALERT_TYPE_CONFIG_KEYS)[keyof typeof ALERT_TYPE_CONFIG_KEYS]

export interface AlertTypeToggles {
  component_status: boolean
  monitor_failure: boolean
  incident_created: boolean
  incident_updated: boolean
  incident_resolved: boolean
}

export interface AlertEmailChannelConfig {
  recipients: string[]
  template_variant: 'default'
}

export interface AlertChannelConfigMetadata {
  type: AlertChannelType
  label: string
  description: string
  icon: string
  available: boolean
}

export interface AlertProjectConfig {
  enabled: boolean
  cooldown_minutes: number
  notify_recovery: boolean
  alert_types: AlertTypeToggles
}

export interface AlertMonitorSnapshot {
  status: 'success' | 'failure' | null
  http_status: number | null
  response_time_ms: number | null
  error_message: string | null
  checked_at: string | null
}

export interface AlertComponentSnapshot {
  id: string
  name: string
  previous_status: ComponentStatus | null
  current_status: ComponentStatus
}

export interface AlertIncidentSnapshot {
  id: string
  title: string
  status: string
  severity: string
  url: string | null
}

export interface AlertPayload {
  project_id: string
  project_name: string
  event_type: AlertEventType
  status: ComponentStatus | string | null
  severity: string | null
  reason: string
  occurred_at: string
  dashboard_url: string | null
  status_page_url: string | null
  component: AlertComponentSnapshot | null
  incident: AlertIncidentSnapshot | null
  monitor: AlertMonitorSnapshot | null
}

export interface StoredAlertEvent {
  id: string
  project_id: string
  type: AlertEventType
  source_type: AlertSourceType
  source_id: string | null
  status: AlertEventStatus
  severity: string | null
  dedupe_key: string
  payload: AlertPayload
  created_at: string
  processed_at: string | null
}

export interface StoredAlertDelivery {
  id: string
  event_id: string
  channel_config_id: string
  target: string
  status: AlertDeliveryStatus
  attempts: number
  next_retry_at: string | null
  provider: string | null
  provider_message_id: string | null
  idempotency_key: string
  error_code: string | null
  error_message: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface StoredAlertChannelConfig {
  id: string
  project_id: string
  type: AlertChannelType
  enabled: boolean
  config: unknown
  secret_ref: string | null
}

export interface AlertDeliveryQueueMessage {
  deliveryId: string
  eventId: string
  projectId: string
  channel: AlertChannelType
}

export interface AlertDeliveryInput<TPayload> {
  delivery: StoredAlertDelivery
  event: StoredAlertEvent
  payload: TPayload
  idempotencyKey: string
}

export interface AlertDeliveryResult {
  status: 'sent' | 'retryable' | 'failed'
  provider: string
  providerMessageId: string | null
  errorCode: string | null
  errorMessage: string | null
}
