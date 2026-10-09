// Domain vocabulary shared by Next.js (via @shared/*) and the Edge Functions.
// Keep in sync with the SQL helpers in supabase/migrations/20261009120100_v2_components_incidents.sql.
// No Deno globals, no URL imports and only relative .ts imports in this folder.

export const COMPONENT_STATUSES = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'] as const
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number]

/** Statuses a person can assert on a component during an incident (maintenance is set by maintenance windows). */
export const INCIDENT_COMPONENT_STATUSES = ['operational', 'degraded', 'partial_outage', 'major_outage'] as const

/** Statuses a monitor, an external signal or a dependency can push onto a component. */
export const PROBLEM_STATUSES = ['degraded', 'partial_outage', 'major_outage'] as const
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number]

const STATUS_RANK: Record<ComponentStatus, number> = {
  major_outage: 5,
  partial_outage: 4,
  degraded: 3,
  maintenance: 2,
  operational: 1,
}

const ALERT_STATUS_RANK: Record<string, number> = { major_outage: 3, partial_outage: 2, degraded: 1 }

export function isComponentStatus(value: unknown): value is ComponentStatus {
  return typeof value === 'string' && (COMPONENT_STATUSES as readonly string[]).includes(value)
}

/** Same order as SQL status_rank(): major > partial > degraded > maintenance > operational. */
export function statusRank(status: string | null | undefined): number {
  return status && isComponentStatus(status) ? STATUS_RANK[status] : 0
}

/** Same order as SQL alert_status_rank(): only problems rank above zero. */
export function alertStatusRank(status: string | null | undefined): number {
  return status ? ALERT_STATUS_RANK[status] ?? 0 : 0
}

export function worstStatus<T extends string | null | undefined>(...statuses: T[]): ComponentStatus | null {
  let worst: ComponentStatus | null = null
  for (const status of statuses) {
    if (!status || !isComponentStatus(status)) continue
    if (worst === null || statusRank(status) > statusRank(worst)) worst = status
  }
  return worst
}

export const COMPONENT_STATUS_LABELS: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  maintenance: 'Under maintenance',
}

export const COMPONENT_STATUS_SHORT_LABELS: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  maintenance: 'Maintenance',
}

/** Headline shown on a status page for the worst component status. */
export const OVERALL_STATUS_HEADLINES: Record<ComponentStatus, string> = {
  operational: 'All systems operational',
  degraded: 'Some systems are degraded',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  maintenance: 'Maintenance in progress',
}

/** Brand-neutral hex colors (dark UI). The light status page uses its own palette from DESIGN.md. */
export const STATUS_COLORS: Record<ComponentStatus, string> = {
  operational: '#34D39A',
  degraded: '#F4B740',
  partial_outage: '#F28A3E',
  major_outage: '#F0525D',
  maintenance: '#5E9BFF',
}

export function statusLabel(status: string | null | undefined, short = false): string {
  if (!status || !isComponentStatus(status)) return 'Unknown'
  return short ? COMPONENT_STATUS_SHORT_LABELS[status] : COMPONENT_STATUS_LABELS[status]
}

export const STATUS_SOURCES = ['default', 'incident', 'maintenance', 'manual', 'monitor', 'signal', 'dependency'] as const
export type StatusSource = (typeof STATUS_SOURCES)[number]

export const STATUS_SOURCE_LABELS: Record<StatusSource, string> = {
  default: 'No signal',
  incident: 'Set by an incident',
  maintenance: 'Maintenance window',
  manual: 'Pinned manually',
  monitor: 'From monitors',
  signal: 'From an external alert',
  dependency: 'From a dependency',
}

// ------------------------------------------------------------------
// Incidents
// ------------------------------------------------------------------
export const INCIDENT_STATUSES = ['draft', 'investigating', 'identified', 'monitoring', 'resolved'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]
export const ACTIVE_INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring'] as const
export const PUBLIC_INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  draft: 'Draft',
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

export const INCIDENT_STATUS_HINTS: Record<IncidentStatus, string> = {
  draft: 'Only your team can see it. Components keep their status.',
  investigating: 'You know something is wrong and are looking into it.',
  identified: 'You found the cause and are working on a fix.',
  monitoring: 'A fix is out and you are watching the results.',
  resolved: 'The issue is over. Components return to their automatic status.',
}

export const INCIDENT_IMPACTS = ['none', 'minor', 'major', 'critical'] as const
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number]

export const INCIDENT_IMPACT_LABELS: Record<IncidentImpact, string> = {
  none: 'No impact',
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
}

const IMPACT_RANK: Record<IncidentImpact, number> = { none: 0, minor: 1, major: 2, critical: 3 }
export function impactRank(impact: string | null | undefined): number {
  return impact && impact in IMPACT_RANK ? IMPACT_RANK[impact as IncidentImpact] : 0
}

export const INCIDENT_SOURCES = ['manual', 'monitor', 'signal', 'api', 'template'] as const
export type IncidentSource = (typeof INCIDENT_SOURCES)[number]

export const INCIDENT_UPDATE_KINDS = ['update', 'note', 'system'] as const
export type IncidentUpdateKind = (typeof INCIDENT_UPDATE_KINDS)[number]
export const UPDATE_VISIBILITIES = ['public', 'internal'] as const
export type UpdateVisibility = (typeof UPDATE_VISIBILITIES)[number]

/** v0 API compatibility: severity ↔ impact. */
export const SEVERITY_TO_IMPACT: Record<string, IncidentImpact> = { critical: 'critical', high: 'major', medium: 'minor', low: 'none' }
export const IMPACT_TO_SEVERITY: Record<IncidentImpact, string> = { critical: 'critical', major: 'high', minor: 'medium', none: 'low' }
/** v0 API compatibility: the component status a legacy severity implied. */
export const SEVERITY_TO_COMPONENT_STATUS: Record<string, ComponentStatus> = {
  critical: 'major_outage',
  high: 'partial_outage',
  medium: 'degraded',
  low: 'degraded',
}

/** Suggested component status for a new incident with this impact. */
export function defaultComponentStatusForImpact(impact: IncidentImpact): ComponentStatus {
  switch (impact) {
    case 'critical':
      return 'major_outage'
    case 'major':
      return 'partial_outage'
    case 'minor':
      return 'degraded'
    default:
      return 'operational'
  }
}

// ------------------------------------------------------------------
// Maintenance
// ------------------------------------------------------------------
export const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number]
export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// ------------------------------------------------------------------
// Monitors
// ------------------------------------------------------------------
export const MONITOR_TYPES = ['http', 'keyword', 'tcp', 'dns', 'tls', 'heartbeat'] as const
export type MonitorType = (typeof MONITOR_TYPES)[number]
export const MONITOR_TYPE_LABELS: Record<MonitorType, string> = {
  http: 'HTTP',
  keyword: 'Keyword',
  tcp: 'TCP port',
  dns: 'DNS record',
  tls: 'TLS certificate',
  heartbeat: 'Heartbeat',
}
export const MONITOR_TYPE_HINTS: Record<MonitorType, string> = {
  http: 'Request a URL and check the status code, headers, body and response time.',
  keyword: 'Request a URL and check that the body contains (or does not contain) a word.',
  tcp: 'Open a TCP connection to a host and port.',
  dns: 'Resolve a record and compare it with the values you expect.',
  tls: 'Check that the certificate is valid and warn before it expires.',
  heartbeat: 'Your cron job or worker pings Upvane. Silence means it stopped running.',
}

export const MONITOR_STATES = ['pending', 'up', 'degraded', 'down', 'paused'] as const
export type MonitorState = (typeof MONITOR_STATES)[number]
export const MONITOR_STATE_LABELS: Record<MonitorState, string> = {
  pending: 'Waiting for first check',
  up: 'Up',
  degraded: 'Degraded',
  down: 'Down',
  paused: 'Paused',
}

/** A single probe result. `error` means the probe itself failed (network to the probe, timeouts of the probe). */
export const CHECK_RESULT_STATUSES = ['up', 'degraded', 'down', 'error'] as const
export type CheckResultStatus = (typeof CHECK_RESULT_STATUSES)[number]

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA'] as const
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number]

// ------------------------------------------------------------------
// Alerts
// ------------------------------------------------------------------
export const ALERT_EVENT_TYPES = [
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
  'maintenance_scheduled',
  'maintenance_reminder',
  'maintenance_started',
  'maintenance_completed',
  'maintenance_cancelled',
  'test',
] as const
export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number]

/** Event types a routing rule can listen to (legacy monitor_check_* types are accepted by SQL but never emitted). */
export const ROUTABLE_EVENT_TYPES = ALERT_EVENT_TYPES.filter((type) => type !== 'test' && type !== 'maintenance_reminder')

export const ALERT_EVENT_LABELS: Record<AlertEventType, string> = {
  component_status_worsened: 'Component got worse',
  component_recovered: 'Component recovered',
  monitor_down: 'Monitor down',
  monitor_degraded: 'Monitor degraded',
  monitor_recovered: 'Monitor recovered',
  tls_expiring: 'Certificate expiring',
  incident_created: 'Incident declared',
  incident_updated: 'Incident updated',
  incident_resolved: 'Incident resolved',
  incident_draft_created: 'Draft incident opened',
  maintenance_scheduled: 'Maintenance scheduled',
  maintenance_reminder: 'Maintenance reminder',
  maintenance_started: 'Maintenance started',
  maintenance_completed: 'Maintenance completed',
  maintenance_cancelled: 'Maintenance cancelled',
  test: 'Test alert',
}

export const ALERT_EVENT_GROUPS: Array<{ label: string; types: AlertEventType[] }> = [
  { label: 'Components', types: ['component_status_worsened', 'component_recovered'] },
  { label: 'Monitors', types: ['monitor_down', 'monitor_degraded', 'monitor_recovered', 'tls_expiring'] },
  { label: 'Incidents', types: ['incident_draft_created', 'incident_created', 'incident_updated', 'incident_resolved'] },
  { label: 'Maintenance', types: ['maintenance_scheduled', 'maintenance_started', 'maintenance_completed', 'maintenance_cancelled'] },
]

export const RECOVERY_EVENT_TYPES: readonly AlertEventType[] = ['component_recovered', 'monitor_recovered']

export const ALERT_CHANNEL_TYPES = ['email', 'slack', 'teams', 'discord', 'webhook', 'pagerduty', 'opsgenie'] as const
export type AlertChannelType = (typeof ALERT_CHANNEL_TYPES)[number]
export const PAGING_CHANNEL_TYPES: readonly AlertChannelType[] = ['pagerduty', 'opsgenie']
export const ALERT_CHANNEL_LABELS: Record<AlertChannelType, string> = {
  email: 'Email',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  discord: 'Discord',
  webhook: 'Webhook',
  pagerduty: 'PagerDuty',
  opsgenie: 'Opsgenie',
}

export const DELIVERY_STATUSES = ['pending', 'processing', 'retryable', 'sent', 'failed', 'suppressed'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const SUBSCRIBER_TYPES = ['email', 'slack', 'webhook'] as const
export type SubscriberType = (typeof SUBSCRIBER_TYPES)[number]

export const INBOUND_INTEGRATION_TYPES = ['alertmanager', 'grafana', 'datadog', 'cloudwatch', 'generic'] as const
export type InboundIntegrationType = (typeof INBOUND_INTEGRATION_TYPES)[number]
export const INBOUND_INTEGRATION_LABELS: Record<InboundIntegrationType, string> = {
  alertmanager: 'Prometheus Alertmanager',
  grafana: 'Grafana Alerting',
  datadog: 'Datadog',
  cloudwatch: 'Amazon CloudWatch (SNS)',
  generic: 'Generic JSON',
}

// ------------------------------------------------------------------
// Organizations
// ------------------------------------------------------------------
export const ORG_ROLES = ['viewer', 'responder', 'admin', 'owner'] as const
export type OrgRole = (typeof ORG_ROLES)[number]
const ROLE_RANK: Record<OrgRole, number> = { viewer: 1, responder: 2, admin: 3, owner: 4 }

export function roleRank(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as OrgRole] : 0
}

export function hasRole(role: string | null | undefined, minRole: OrgRole): boolean {
  return roleRank(role) >= ROLE_RANK[minRole]
}

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  viewer: 'Viewer',
  responder: 'Responder',
  admin: 'Admin',
  owner: 'Owner',
}

export const ORG_ROLE_HINTS: Record<OrgRole, string> = {
  viewer: 'Sees everything except secrets. Cannot change anything.',
  responder: 'Declares and updates incidents, schedules maintenance, runs checks.',
  admin: 'Configures components, monitors, alerts, the status page, API keys and invitations.',
  owner: 'Everything, plus billing and managing owners.',
}

export const API_KEY_SCOPES = ['read', 'write'] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]
