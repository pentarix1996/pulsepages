// Row shapes of the v2 schema as the app reads them. Source of truth: supabase/migrations/2026100912*.sql.
import type {
  AlertChannelType,
  ApiKeyScope,
  CheckResultStatus,
  ComponentStatus,
  DeliveryStatus,
  InboundIntegrationType,
  IncidentImpact,
  IncidentSource,
  IncidentStatus,
  IncidentUpdateKind,
  MaintenanceStatus,
  MonitorState,
  MonitorType,
  OrgRole,
  ProblemStatus,
  StatusSource,
  SubscriberType,
  Theme,
  UpdateVisibility,
} from '@shared/domain.ts'
import type { Plan } from '@shared/plans.ts'

export type Uuid = string
export type Timestamp = string

export interface ProfileRow {
  id: Uuid
  name: string | null
  username: string | null
  plan: Plan
  created_at: Timestamp
}

export interface OrganizationRow {
  id: Uuid
  name: string
  slug: string
  plan: Plan
  personal: boolean
  sso_domain: string | null
  require_2fa: boolean
  created_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface OrganizationMemberRow {
  organization_id: Uuid
  user_id: Uuid
  role: OrgRole
  created_at: Timestamp
}

export interface InvitationRow {
  id: Uuid
  organization_id: Uuid
  email: string
  role: OrgRole
  invited_by: Uuid | null
  expires_at: Timestamp
  accepted_at: Timestamp | null
  accepted_by: Uuid | null
  revoked_at: Timestamp | null
  created_at: Timestamp
}

export interface AuditLogRow {
  id: number
  organization_id: Uuid
  project_id: Uuid | null
  actor_type: 'user' | 'api_key' | 'system'
  actor_id: string | null
  actor_label: string | null
  action: string
  target_type: string | null
  target_id: string | null
  metadata: Record<string, unknown>
  ip: string | null
  created_at: Timestamp
}

export interface ProjectRow {
  id: Uuid
  organization_id: Uuid
  user_id: Uuid | null
  name: string
  slug: string
  description: string | null
  created_at: Timestamp
  updated_at: Timestamp
  visibility: 'public' | 'private'
  brand_color: string | null
  logo_url: string | null
  theme_default: Theme
  timezone: string
  hide_powered_by: boolean
  custom_domain: string | null
  custom_domain_status: 'none' | 'pending' | 'verified' | 'error' | 'suspended'
  custom_domain_verified_at: Timestamp | null
  custom_domain_error: string | null
  allowed_ips: string[]
  support_url: string | null
  auto_postmortem: boolean
  auto_draft_incidents: boolean
  uptime_weights: Record<string, number>
}

export interface ComponentGroupRow {
  id: Uuid
  project_id: Uuid
  name: string
  position: number
  collapsed: boolean
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ComponentRow {
  id: Uuid
  project_id: Uuid
  name: string
  slug: string
  description: string | null
  group_id: Uuid | null
  position: number
  status: ComponentStatus
  status_source: StatusSource
  status_changed_at: Timestamp | null
  manual_status: ComponentStatus | null
  manual_status_set_by: Uuid | null
  manual_status_set_at: Timestamp | null
  automated_status: ComponentStatus | null
  automated_source: 'monitor' | 'signal' | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ComponentDependencyRow {
  component_id: Uuid
  depends_on_id: Uuid
  impact: ProblemStatus
  created_at: Timestamp
}

export interface ComponentStatusHistoryRow {
  id: Uuid
  component_id: Uuid
  status: ComponentStatus
  changed_at: Timestamp
  reason: string
  incident_id: Uuid | null
}

export interface IncidentRow {
  id: Uuid
  project_id: Uuid
  title: string
  description: string | null
  status: IncidentStatus
  impact: IncidentImpact
  severity: string | null
  component_ids: Uuid[]
  detected_at: Timestamp
  acknowledged_at: Timestamp | null
  acknowledged_by: Uuid | null
  published_at: Timestamp | null
  resolved_at: Timestamp | null
  created_by: Uuid | null
  source: IncidentSource
  source_monitor_id: Uuid | null
  deleted_at: Timestamp | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface IncidentComponentRow {
  incident_id: Uuid
  component_id: Uuid
  status: ComponentStatus
  updated_at: Timestamp
}

export interface IncidentUpdateRow {
  id: Uuid
  incident_id: Uuid
  kind: IncidentUpdateKind
  visibility: UpdateVisibility
  status: IncidentStatus | null
  message: string
  component_statuses: Record<Uuid, ComponentStatus>
  notify_subscribers: boolean
  created_by: Uuid | null
  actor_label: string | null
  created_at: Timestamp
}

export interface IncidentTemplateRow {
  id: Uuid
  project_id: Uuid
  name: string
  title: string
  message: string
  impact: IncidentImpact
  status: 'investigating' | 'identified' | 'monitoring'
  component_statuses: Record<string, ComponentStatus>
  created_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface PostmortemActionItem {
  id: string
  title: string
  owner?: string | null
  due_date?: string | null
  done: boolean
  url?: string | null
}

export interface PostmortemTimelineEntry {
  at: Timestamp
  kind?: string
  visibility?: string
  status?: string | null
  message: string
}

export interface PostmortemRow {
  id: Uuid
  incident_id: Uuid
  project_id: Uuid
  status: 'draft' | 'published'
  title: string
  summary: string
  impact: string
  root_cause: string
  resolution: string
  lessons: string
  action_items: PostmortemActionItem[]
  timeline: PostmortemTimelineEntry[]
  published_at: Timestamp | null
  created_by: Uuid | null
  updated_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface MaintenanceRow {
  id: Uuid
  project_id: Uuid
  title: string
  description: string
  status: MaintenanceStatus
  scheduled_start: Timestamp
  scheduled_end: Timestamp
  actual_start: Timestamp | null
  actual_end: Timestamp | null
  auto_start: boolean
  auto_complete: boolean
  notify_subscribers: boolean
  reminder_minutes: number
  reminder_sent_at: Timestamp | null
  mute_alerts: boolean
  created_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface MaintenanceUpdateRow {
  id: Uuid
  maintenance_id: Uuid
  status: MaintenanceStatus | null
  message: string
  created_by: Uuid | null
  actor_label: string | null
  created_at: Timestamp
}

export interface MonitorRow {
  id: Uuid
  project_id: Uuid
  name: string
  type: MonitorType
  enabled: boolean
  paused_reason: string | null
  interval_seconds: number
  timeout_ms: number
  regions: string[]
  confirm_failures: number
  confirm_regions: number
  recovery_successes: number
  config: Record<string, unknown>
  failure_status: ProblemStatus
  degraded_status: ProblemStatus
  state: MonitorState
  state_changed_at: Timestamp | null
  last_checked_at: Timestamp | null
  next_check_at: Timestamp
  last_result: Record<string, unknown> | null
  last_error: string | null
  heartbeat_token: string | null
  last_heartbeat_at: Timestamp | null
  tls_expires_at: Timestamp | null
  tls_checked_at: Timestamp | null
  auto_draft_incident: boolean
  legacy_config_id: Uuid | null
  created_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface MonitorRegionStateRow {
  monitor_id: Uuid
  region: string
  consecutive_bad: number
  consecutive_up: number
  confirmed: 'up' | 'degraded' | 'down'
  last_status: CheckResultStatus | null
  last_latency_ms: number | null
  last_error: string | null
  last_checked_at: Timestamp | null
}

export interface MonitorCheckResultRow {
  id: Uuid
  monitor_id: Uuid | null
  project_id: Uuid
  region: string | null
  status: CheckResultStatus | 'success' | 'failure'
  resulting_status: ComponentStatus | null
  http_status: number | null
  response_time_ms: number | null
  error_message: string | null
  details: Record<string, unknown> | null
  checked_at: Timestamp
}

export interface InboundIntegrationRow {
  id: Uuid
  project_id: Uuid
  type: InboundIntegrationType
  name: string
  token: string
  enabled: boolean
  mappings: Array<{ match: Record<string, string>; component_id: Uuid; status?: ProblemStatus }>
  default_component_id: Uuid | null
  default_status: ProblemStatus
  auto_draft_incident: boolean
  last_received_at: Timestamp | null
  last_error: string | null
  received_count: number
  created_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ComponentSignalRow {
  id: Uuid
  project_id: Uuid
  component_id: Uuid
  integration_id: Uuid
  external_id: string
  status: ProblemStatus
  summary: string | null
  labels: Record<string, unknown>
  active: boolean
  started_at: Timestamp
  resolved_at: Timestamp | null
  updated_at: Timestamp
}

export interface ProjectAlertConfigRow {
  project_id: Uuid
  enabled: boolean
  mute_during_maintenance: boolean
}

export interface AlertChannelRow {
  id: Uuid
  project_id: Uuid
  type: AlertChannelType
  name: string
  enabled: boolean
  config: Record<string, unknown>
  legacy_config_id: Uuid | null
  created_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface AlertEmailRecipientRow {
  id: Uuid
  channel_id: Uuid
  email: string
  verified_at: Timestamp | null
  verification_sent_at: Timestamp | null
  created_at: Timestamp
}

export interface AlertRuleRow {
  id: Uuid
  project_id: Uuid
  name: string
  enabled: boolean
  event_types: string[]
  component_ids: Uuid[]
  monitor_ids: Uuid[]
  min_status: ProblemStatus | null
  channel_ids: Uuid[]
  cooldown_minutes: number
  position: number
  created_by: Uuid | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface AlertEventRow {
  id: Uuid
  project_id: Uuid
  type: string
  source_type: string
  source_id: string | null
  status: 'pending' | 'processed' | 'suppressed' | 'failed'
  severity: string | null
  dedupe_key: string
  payload: Record<string, unknown>
  audience: 'team' | 'subscribers'
  suppression_reason: string | null
  component_id: Uuid | null
  monitor_id: Uuid | null
  incident_id: Uuid | null
  maintenance_id: Uuid | null
  channel_id: Uuid | null
  created_at: Timestamp
  processed_at: Timestamp | null
}

export interface AlertDeliveryRow {
  id: Uuid
  event_id: Uuid
  channel_id: Uuid | null
  subscriber_id: Uuid | null
  rule_id: Uuid | null
  target: string
  target_type: string
  status: DeliveryStatus
  attempts: number
  next_retry_at: Timestamp | null
  provider: string | null
  provider_message_id: string | null
  error_code: string | null
  error_message: string | null
  sent_at: Timestamp | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface SubscriberRow {
  id: Uuid
  project_id: Uuid
  type: SubscriberType
  email: string | null
  target_hint: string | null
  component_ids: Uuid[]
  confirmed_at: Timestamp | null
  last_notified_at: Timestamp | null
  created_at: Timestamp
}

export interface StatusPageAccessTokenRow {
  id: Uuid
  project_id: Uuid
  name: string
  prefix: string
  created_by: Uuid | null
  created_at: Timestamp
  expires_at: Timestamp | null
  revoked_at: Timestamp | null
  last_used_at: Timestamp | null
}

export interface SloRow {
  id: Uuid
  project_id: Uuid
  component_id: Uuid | null
  name: string
  target: number
  window_days: 7 | 14 | 28 | 30 | 90
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ApiKeyRow {
  id: Uuid
  organization_id: Uuid
  project_id: Uuid | null
  user_id: Uuid | null
  name: string
  prefix: string | null
  scopes: ApiKeyScope[]
  expires_at: Timestamp | null
  last_used_at: Timestamp | null
  revoked_at: Timestamp | null
  created_by: Uuid | null
  created_at: Timestamp
}

/** get_project_metrics() */
export interface ProjectMetrics {
  from: Timestamp
  to: Timestamp
  uptime: number
  components: Array<{
    id: Uuid
    name: string
    slug: string
    status: ComponentStatus
    uptime: number
    downtime_seconds: number
    major_seconds: number
    partial_seconds: number
    degraded_seconds: number
    maintenance_seconds: number
  }>
  incidents: {
    total: number
    by_impact: Partial<Record<IncidentImpact, number>>
    mtta_seconds: number | null
    mttr_seconds: number | null
    longest_seconds: number | null
    list: Array<{
      id: Uuid
      title: string
      impact: IncidentImpact
      status: IncidentStatus
      detected_at: Timestamp
      acknowledged_at: Timestamp | null
      resolved_at: Timestamp | null
      duration_seconds: number
    }>
  }
  slos: Array<{
    id: Uuid
    name: string
    target: number
    window_days: number
    component_id: Uuid | null
    actual: number
    allowed_downtime_seconds: number
    consumed_downtime_seconds: number
    budget_remaining: number
  }>
}

/** component_daily_status() row */
export interface DailyStatusRow {
  component_id: Uuid
  day: string
  worst_status: ComponentStatus | null
  downtime_seconds: number
  major_seconds: number
  partial_seconds: number
  degraded_seconds: number
  maintenance_seconds: number
  incident_ids: Uuid[]
  has_data: boolean
}
