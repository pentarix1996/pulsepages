// Shapes returned by the status page SQL functions (supabase/migrations/20261009120500_v2_status_page_api.sql and
// 20261009130600_v2_status_page_extras.sql). Pure types and light normalisation, usable on server and client.
import { isComponentStatus, type ComponentStatus, type IncidentImpact, type IncidentStatus, type MaintenanceStatus, type Theme } from '@shared/domain.ts'

export interface StatusProject {
  id: string
  name: string
  slug: string
  description: string | null
  organization_slug: string
  organization_name: string
  visibility: 'public' | 'private'
  brand_color: string | null
  logo_url: string | null
  theme_default: Theme
  timezone: string
  support_url: string | null
  hide_powered_by: boolean
  /** Verified custom domain only. */
  custom_domain: string | null
  history_days: number
  bar_days: number
}

export interface StatusGroup {
  id: string
  name: string
  position: number
  collapsed: boolean
}

export interface StatusDay {
  date: string
  status: ComponentStatus | null
  downtime_minutes: number
  major_minutes: number
  partial_minutes: number
  degraded_minutes: number
  maintenance_minutes: number
  incidents: Array<{ id: string; title: string; impact: IncidentImpact }>
}

export interface StatusComponent {
  id: string
  name: string
  slug: string
  description: string | null
  status: ComponentStatus
  group_id: string | null
  position: number
  uptime: number | null
  days: StatusDay[]
}

export interface StatusIncidentUpdate {
  id: string
  status: IncidentStatus
  message: string
  created_at: string
  /** Component statuses asserted by this update (only on full incident payloads). */
  components?: Record<string, ComponentStatus>
}

export interface StatusPostmortem {
  title?: string | null
  summary: string | null
  impact: string | null
  root_cause: string | null
  resolution: string | null
  lessons: string | null
  action_items?: Array<{ title: string; done: boolean }>
  published_at: string | null
}

export interface StatusIncident {
  id: string
  title: string
  status: IncidentStatus
  impact: IncidentImpact
  started_at: string
  resolved_at: string | null
  updated_at: string
  components: Array<{ id: string; name: string; status: ComponentStatus }>
  /** Newest first. Full payloads carry every public update; list payloads only the latest one. */
  updates: StatusIncidentUpdate[]
  postmortem: StatusPostmortem | null
}

export interface StatusMaintenanceUpdate {
  id: string
  status: MaintenanceStatus
  message: string
  created_at: string
}

export interface StatusMaintenance {
  id: string
  title: string
  description: string
  status: MaintenanceStatus
  scheduled_start: string
  scheduled_end: string
  actual_start: string | null
  actual_end: string | null
  components: Array<{ id: string; name: string }>
  /** Newest first. */
  updates: StatusMaintenanceUpdate[]
}

export interface StatusPageData {
  private: false
  generated_at: string
  project: StatusProject
  overall_status: ComponentStatus
  groups: StatusGroup[]
  components: StatusComponent[]
  active_incidents: StatusIncident[]
  /** Scheduled and in-progress windows, soonest first. */
  maintenances: StatusMaintenance[]
  /** Resolved in the last 7 days (latest update only). */
  recent_incidents: StatusIncident[]
  /** Completed in the last 7 days. */
  recent_maintenances: StatusMaintenance[]
}

/** What a visitor without access learns about a private page. */
export interface PrivatePageStub {
  private: true
  project: {
    id: string
    name: string
    slug: string
    organization_slug: string
    organization_name: string
    sso_domain: string | null
    brand_color: string | null
    logo_url: string | null
  }
}

export type StatusPagePayload = StatusPageData | PrivatePageStub

/** Project fields carried by the incident, maintenance and history payloads. */
export interface StatusProjectSummary {
  id: string
  name: string
  slug: string
  organization_slug: string
  brand_color: string | null
  logo_url: string | null
  theme_default: Theme
  timezone: string
  hide_powered_by: boolean
  custom_domain: string | null
  history_days?: number
}

export interface IncidentPayload {
  project: StatusProjectSummary
  incident: StatusIncident
}

export interface MaintenancePayload {
  project: StatusProjectSummary
  maintenance: StatusMaintenance
}

export type HistoryItem =
  | { kind: 'incident'; at: string; item: StatusIncident }
  | { kind: 'maintenance'; at: string; item: StatusMaintenance }

export interface HistoryPayload {
  project: StatusProjectSummary
  /** Newest first. */
  items: HistoryItem[]
}

/** Server-only facts about a project (status_page_access_info). */
export interface PageAccessInfo {
  id: string
  name: string
  slug: string
  visibility: 'public' | 'private'
  organization_slug: string
  organization_name: string
  sso_domain: string | null
  allowed_ips: string[]
  custom_domain: string | null
  brand_color: string | null
  logo_url: string | null
  theme_default: Theme
  timezone: string
}

// ------------------------------------------------------------------
// Normalisation: the SQL is ours, so this only fills defaults and drops unknown statuses.
// ------------------------------------------------------------------
const arr = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

function status(value: unknown): ComponentStatus {
  return isComponentStatus(value) ? value : 'operational'
}

export function normalizeIncident(raw: StatusIncident): StatusIncident {
  return {
    ...raw,
    components: arr<StatusIncident['components'][number]>(raw.components).map((component) => ({ ...component, status: status(component.status) })),
    updates: arr<StatusIncidentUpdate>(raw.updates).map((update) => ({ ...update, message: update.message ?? '' })),
    postmortem: raw.postmortem
      ? { ...raw.postmortem, action_items: arr<{ title: string; done: boolean }>(raw.postmortem.action_items).filter((item) => item && typeof item.title === 'string') }
      : null,
  }
}

export function normalizeMaintenance(raw: StatusMaintenance): StatusMaintenance {
  return {
    ...raw,
    description: raw.description ?? '',
    components: arr<StatusMaintenance['components'][number]>(raw.components),
    updates: arr<StatusMaintenanceUpdate>(raw.updates).map((update) => ({ ...update, message: update.message ?? '' })),
  }
}

export function normalizePage(raw: StatusPageData): StatusPageData {
  return {
    ...raw,
    overall_status: status(raw.overall_status),
    groups: arr<StatusGroup>(raw.groups),
    components: arr<StatusComponent>(raw.components).map((component) => ({
      ...component,
      status: status(component.status),
      days: arr<StatusDay>(component.days).map((day) => ({ ...day, status: isComponentStatus(day.status) ? day.status : null, incidents: arr(day.incidents) })),
    })),
    active_incidents: arr<StatusIncident>(raw.active_incidents).map(normalizeIncident),
    maintenances: arr<StatusMaintenance>(raw.maintenances).map(normalizeMaintenance),
    recent_incidents: arr<StatusIncident>(raw.recent_incidents).map(normalizeIncident),
    recent_maintenances: arr<StatusMaintenance>(raw.recent_maintenances).map(normalizeMaintenance),
  }
}

export function normalizeHistory(raw: HistoryPayload): HistoryPayload {
  return {
    ...raw,
    items: arr<HistoryItem>(raw.items).map((entry) =>
      entry.kind === 'incident' ? { ...entry, item: normalizeIncident(entry.item) } : { ...entry, item: normalizeMaintenance(entry.item as StatusMaintenance) },
    ) as HistoryItem[],
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
