// View models for the public status page: overall status sentence, grouped components, the "past 7 days" list and
// small labelling helpers. Pure and isomorphic.
import {
  COMPONENT_STATUS_LABELS,
  INCIDENT_STATUS_LABELS,
  MAINTENANCE_STATUS_LABELS,
  OVERALL_STATUS_HEADLINES,
  isComponentStatus,
  statusRank,
  worstStatus,
  type ComponentStatus,
  type IncidentImpact,
} from '@shared/domain.ts'
import { addDays, localDateKey } from './time'
import type { StatusComponent, StatusGroup, StatusIncident, StatusIncidentUpdate, StatusMaintenance, StatusPageData, StatusProject } from './types'

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function joinNames(names: string[], max = 3): string {
  const list = names.filter(Boolean)
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]!
  if (list.length > max) return `${list.slice(0, max).join(', ')} and ${list.length - max} more`
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export interface OverallSummary {
  status: ComponentStatus
  headline: string
  detail: string
}

/** Headline (worst component status) plus a sentence that names what is affected. */
export function overallSummary(page: Pick<StatusPageData, 'overall_status' | 'components' | 'active_incidents'>): OverallSummary {
  const status = page.overall_status
  const headline = OVERALL_STATUS_HEADLINES[status]
  const problems = page.components.filter((component) => component.status !== 'operational' && component.status !== 'maintenance')
  const maintenance = page.components.filter((component) => component.status === 'maintenance')
  if (page.components.length === 0) {
    return { status, headline, detail: page.active_incidents.length > 0 ? 'We are working on an incident. Follow the updates below.' : 'Nothing to report.' }
  }
  if (problems.length === 0 && maintenance.length === 0) {
    return {
      status,
      headline,
      detail: page.active_incidents.length > 0 ? 'Every component is working. We are still following up on an incident.' : 'Every component is working normally.',
    }
  }
  const parts: string[] = []
  if (problems.length > 0) {
    const sorted = [...problems].sort((a, b) => statusRank(b.status) - statusRank(a.status))
    parts.push(`${joinNames(sorted.map((component) => component.name))} ${problems.length === 1 ? 'is' : 'are'} affected`)
  }
  if (maintenance.length > 0) {
    parts.push(`${joinNames(maintenance.map((component) => component.name))} ${maintenance.length === 1 ? 'is' : 'are'} under maintenance`)
  }
  const everythingElse = problems.length + maintenance.length < page.components.length ? ' Everything else is working normally.' : ''
  return { status, headline, detail: `${parts.join(' and ')}.${everythingElse}` }
}

export interface ComponentSection {
  group: StatusGroup | null
  components: StatusComponent[]
  status: ComponentStatus
}

/** Ungrouped components first, then groups by position; components keep the order from SQL (position, name). */
export function componentSections(page: Pick<StatusPageData, 'groups' | 'components'>): ComponentSection[] {
  const byGroup = new Map<string, StatusComponent[]>()
  const loose: StatusComponent[] = []
  const known = new Set(page.groups.map((group) => group.id))
  for (const component of page.components) {
    if (component.group_id && known.has(component.group_id)) {
      const list = byGroup.get(component.group_id) ?? []
      list.push(component)
      byGroup.set(component.group_id, list)
    } else {
      loose.push(component)
    }
  }
  const sections: ComponentSection[] = []
  if (loose.length > 0) sections.push({ group: null, components: loose, status: worstStatus(...loose.map((c) => c.status)) ?? 'operational' })
  for (const group of [...page.groups].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
    const components = byGroup.get(group.id) ?? []
    if (components.length === 0) continue
    sections.push({ group, components, status: worstStatus(...components.map((c) => c.status)) ?? 'operational' })
  }
  return sections
}

/**
 * Uptime over the last `days` bars, from the per-day weighted downtime (minutes). Used for the shorter phone window;
 * the full window uses the SQL value.
 */
export function windowUptime(days: StatusComponent['days'], count: number, now: Date = new Date(), timeZone = 'UTC'): number | null {
  const window = days.slice(-count).filter((day) => day.status !== null)
  if (window.length === 0) return null
  const today = localDateKey(now, timeZone)
  let total = 0
  let down = 0
  for (const day of window) {
    if (day.date === today) {
      const [hh, mm] = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number) as [number, number]
      total += Math.max(1, hh * 60 + mm)
    } else {
      total += 1440
    }
    down += Math.max(0, day.downtime_minutes ?? 0)
  }
  if (total <= 0) return null
  return Math.max(0, Math.min(100, 100 - (down / total) * 100))
}

// ------------------------------------------------------------------
// Past days
// ------------------------------------------------------------------
export type PastEntry =
  | { kind: 'incident'; at: string; incident: StatusIncident; ongoing: boolean }
  | { kind: 'maintenance'; at: string; maintenance: StatusMaintenance }

export interface PastDay {
  /** YYYY-MM-DD in the page's time zone. */
  key: string
  entries: PastEntry[]
}

/** The last `count` days (today first) in the page's time zone with the incidents and maintenance that started on each. */
export function pastDays(page: Pick<StatusPageData, 'active_incidents' | 'recent_incidents' | 'recent_maintenances'>, timeZone: string, now: Date = new Date(), count = 7): PastDay[] {
  const today = localDateKey(now, timeZone)
  const days: PastDay[] = Array.from({ length: count }, (_, index) => ({ key: addDays(today, -index), entries: [] }))
  const byKey = new Map(days.map((day) => [day.key, day]))
  const push = (at: string, entry: PastEntry) => byKey.get(localDateKey(at, timeZone))?.entries.push(entry)
  for (const incident of page.active_incidents) push(incident.started_at, { kind: 'incident', at: incident.started_at, incident, ongoing: true })
  for (const incident of page.recent_incidents) push(incident.started_at, { kind: 'incident', at: incident.started_at, incident, ongoing: false })
  for (const maintenance of page.recent_maintenances) {
    const at = maintenance.actual_start ?? maintenance.scheduled_start
    push(at, { kind: 'maintenance', at, maintenance })
  }
  for (const day of days) day.entries.sort((a, b) => b.at.localeCompare(a.at))
  return days
}

// ------------------------------------------------------------------
// Labels and tones
// ------------------------------------------------------------------
export const IMPACT_LABELS: Record<IncidentImpact, string> = {
  none: 'No impact',
  minor: 'Minor impact',
  major: 'Major impact',
  critical: 'Critical impact',
}

/** Status color class used for an impact chip. */
export const IMPACT_TONE: Record<IncidentImpact, ComponentStatus | 'none'> = {
  none: 'none',
  minor: 'degraded',
  major: 'partial_outage',
  critical: 'major_outage',
}

export function incidentStatusLabel(status: string): string {
  return (INCIDENT_STATUS_LABELS as Record<string, string>)[status] ?? status
}

export function maintenanceStatusLabel(status: string): string {
  return (MAINTENANCE_STATUS_LABELS as Record<string, string>)[status] ?? status
}

export function componentStatusLabel(status: string | null | undefined): string {
  return isComponentStatus(status) ? COMPONENT_STATUS_LABELS[status] : 'No data'
}

/**
 * Color of an update's stage label: green once resolved, otherwise the worst component status the update asserted,
 * falling back to the incident impact.
 */
export function updateTone(update: Pick<StatusIncidentUpdate, 'status' | 'components'>, impact: IncidentImpact): ComponentStatus | 'none' {
  if (update.status === 'resolved') return 'operational'
  const worst = worstStatus(...Object.values(update.components ?? {}))
  if (worst && worst !== 'operational') return worst
  return IMPACT_TONE[impact] ?? 'none'
}

/** Component status changes an update made, by name ("Webhooks: Degraded performance"). */
export function updateComponentChanges(update: StatusIncidentUpdate, names: Map<string, string>): Array<{ id: string; name: string; status: ComponentStatus }> {
  const out: Array<{ id: string; name: string; status: ComponentStatus }> = []
  for (const [id, status] of Object.entries(update.components ?? {})) {
    const name = names.get(id)
    if (!name || !isComponentStatus(status)) continue
    out.push({ id, name, status })
  }
  return out.sort((a, b) => statusRank(b.status) - statusRank(a.status) || a.name.localeCompare(b.name))
}

/** "<name> status", without doubling a trailing "status". */
export function pageTitle(project: Pick<StatusProject, 'name'>): string {
  const name = project.name.trim()
  return /\bstatus$/i.test(name) ? name : `${name} status`
}

/** Durations like "38 min" or "1 h 10 min" between two instants. */
export function durationBetween(start: string, end: string | null | undefined): string | null {
  if (!end) return null
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`
  const daysCount = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${daysCount} d ${restHours} h` : `${daysCount} d`
}

/** Map of every component id the page knows to its name (for update snapshots). */
export function componentNameMap(page: Pick<StatusPageData, 'components'>, extra: Array<{ id: string; name: string }> = []): Map<string, string> {
  const names = new Map<string, string>()
  for (const component of page.components) names.set(component.id, component.name)
  for (const component of extra) if (!names.has(component.id)) names.set(component.id, component.name)
  return names
}
