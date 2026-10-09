import 'server-only'
import type { ComponentStatus, IncidentImpact } from '@shared/domain.ts'
import { requireProject, type ProjectAccess } from './access'
import type { DomainContext } from './context'
import { fromDatabaseError, invalid } from './errors'
import { MAX_METRICS_RANGE_DAYS, type ComponentUptimeResource, type MetricsQuery } from './schemas/metrics'
import type { ProjectMetrics } from './types'

const DAY_MS = 86_400_000

// ------------------------------------------------------------------ ranges
/** Turns `from`/`to` query values into a validated range: to ≤ now, from < to, at most 400 days. */
export function resolveMetricsRange(query: MetricsQuery, now: Date = new Date()): { from: Date; to: Date } {
  const parse = (value: string, field: 'from' | 'to') => {
    const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
    if (Number.isNaN(date.getTime())) throw invalid(`${field} is not a valid date.`, [{ path: field, message: 'Use an ISO 8601 date or date-time.' }])
    return date
  }
  let to = query.to ? parse(query.to, 'to') : now
  if (to.getTime() > now.getTime()) to = now
  const from = query.from ? parse(query.from, 'from') : new Date(to.getTime() - 30 * DAY_MS)
  if (from.getTime() >= to.getTime()) throw invalid('from must be earlier than to (and to cannot be in the future).', [{ path: 'from', message: 'Must be earlier than to.' }])
  if (to.getTime() - from.getTime() > MAX_METRICS_RANGE_DAYS * DAY_MS) {
    throw invalid(`Use a range of at most ${MAX_METRICS_RANGE_DAYS} days.`, [{ path: 'from', message: `At most ${MAX_METRICS_RANGE_DAYS} days before to.` }])
  }
  return { from, to }
}

async function projectMetrics(ctx: DomainContext, projectId: string, from: Date, to: Date): Promise<ProjectMetrics> {
  const { data, error } = await ctx.db.rpc('get_project_metrics', { p_project_id: projectId, p_from: from.toISOString(), p_to: to.toISOString() })
  if (error) throw fromDatabaseError(error, 'Status page')
  return normalizeMetrics(data as ProjectMetrics)
}

/** Numbers from numeric columns can arrive as strings; make every number a number. */
function normalizeMetrics(raw: ProjectMetrics): ProjectMetrics {
  const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value))
  const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return {
    from: raw.from,
    to: raw.to,
    uptime: num(raw.uptime),
    components: (raw.components ?? []).map((component) => ({
      ...component,
      uptime: num(component.uptime),
      downtime_seconds: num(component.downtime_seconds),
      major_seconds: num(component.major_seconds),
      partial_seconds: num(component.partial_seconds),
      degraded_seconds: num(component.degraded_seconds),
      maintenance_seconds: num(component.maintenance_seconds),
    })),
    incidents: {
      total: num(raw.incidents?.total),
      by_impact: Object.fromEntries(Object.entries(raw.incidents?.by_impact ?? {}).map(([impact, count]) => [impact, num(count)])) as Partial<Record<IncidentImpact, number>>,
      mtta_seconds: numOrNull(raw.incidents?.mtta_seconds),
      mttr_seconds: numOrNull(raw.incidents?.mttr_seconds),
      longest_seconds: numOrNull(raw.incidents?.longest_seconds),
      list: (raw.incidents?.list ?? []).map((incident) => ({ ...incident, duration_seconds: num(incident.duration_seconds) })),
    },
    slos: (raw.slos ?? []).map((slo) => ({
      ...slo,
      target: num(slo.target),
      actual: num(slo.actual),
      allowed_downtime_seconds: num(slo.allowed_downtime_seconds),
      consumed_downtime_seconds: num(slo.consumed_downtime_seconds),
      budget_remaining: num(slo.budget_remaining),
    })),
  }
}

/** GET /projects/{project}/metrics: uptime, incidents (MTTA/MTTR) and SLO budgets for a range. */
export async function getProjectMetrics(ctx: DomainContext, projectRef: string, query: MetricsQuery): Promise<ProjectMetrics> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const { from, to } = resolveMetricsRange(query)
  return projectMetrics(ctx, access.project.id, from, to)
}

/** Same as getProjectMetrics for callers that already resolved access and the range (pages, exports). */
export function metricsForRange(ctx: DomainContext, access: ProjectAccess, from: Date, to: Date): Promise<ProjectMetrics> {
  return projectMetrics(ctx, access.project.id, from, to)
}

// ------------------------------------------------------------------ uptime bars
export interface UptimeDayDetail {
  date: string
  status: ComponentStatus | null
  downtime_minutes: number
  major_minutes: number
  partial_minutes: number
  degraded_minutes: number
  maintenance_minutes: number
  incidents: Array<{ id: string; title: string; impact: IncidentImpact }>
}

export interface ComponentUptimeDetail {
  component_id: string
  slug: string
  name: string
  status: ComponentStatus
  group_id: string | null
  position: number
  uptime: number
  days: UptimeDayDetail[]
}

/** Daily status per component (worst status per day in the page time zone) and uptime over `days`. */
export async function projectUptimeDetail(ctx: DomainContext, projectId: string, days: number): Promise<{ timezone: string; days: number; components: ComponentUptimeDetail[] }> {
  const { data, error } = await ctx.db.rpc('get_project_uptime', { p_project_id: projectId, p_days: days })
  if (error) throw fromDatabaseError(error, 'Status page')
  const raw = (data ?? {}) as { timezone?: string; days?: number; components?: ComponentUptimeDetail[] }
  return {
    timezone: raw.timezone ?? 'UTC',
    days: Number(raw.days ?? days),
    components: (raw.components ?? []).map((component) => ({
      ...component,
      uptime: Number(component.uptime),
      days: (component.days ?? []).map((day) => ({
        ...day,
        downtime_minutes: Number(day.downtime_minutes ?? 0),
        major_minutes: Number(day.major_minutes ?? 0),
        partial_minutes: Number(day.partial_minutes ?? 0),
        degraded_minutes: Number(day.degraded_minutes ?? 0),
        maintenance_minutes: Number(day.maintenance_minutes ?? 0),
        incidents: day.incidents ?? [],
      })),
    })),
  }
}

/** GET /projects/{project}/uptime?days= */
export async function getProjectUptime(ctx: DomainContext, projectRef: string, days: number): Promise<ComponentUptimeResource[]> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const detail = await projectUptimeDetail(ctx, access.project.id, days)
  return detail.components.map((component) => ({
    component_id: component.component_id,
    slug: component.slug,
    name: component.name,
    uptime: component.uptime,
    days: component.days.map((day) => ({ date: day.date, status: day.status, downtime_minutes: day.downtime_minutes })),
  }))
}

// ------------------------------------------------------------------ latency
export interface ProjectLatency {
  from: string
  to: string
  bucket_minutes: number
  checks: number
  p50_ms: number | null
  p95_ms: number | null
  buckets: Array<{ at: string; p95_ms: number | null; checks: number }>
  monitors: Array<{ monitor_id: string; p50_ms: number | null; p95_ms: number | null; checks: number }>
  components: Array<{ component_id: string; p95_ms: number | null; checks: number }>
}

/** p50/p95 response time over a range (≤ 7 days), per time bucket, per monitor and per linked component. */
export async function projectLatency(ctx: DomainContext, projectId: string, from: Date, to: Date, bucketMinutes = 60): Promise<ProjectLatency> {
  const { data, error } = await ctx.db.rpc('get_project_latency', { p_project_id: projectId, p_from: from.toISOString(), p_to: to.toISOString(), p_bucket_minutes: bucketMinutes })
  if (error) throw fromDatabaseError(error, 'Status page')
  const raw = (data ?? {}) as Partial<ProjectLatency>
  const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return {
    from: raw.from ?? from.toISOString(),
    to: raw.to ?? to.toISOString(),
    bucket_minutes: Number(raw.bucket_minutes ?? bucketMinutes),
    checks: Number(raw.checks ?? 0),
    p50_ms: numOrNull(raw.p50_ms),
    p95_ms: numOrNull(raw.p95_ms),
    buckets: (raw.buckets ?? []).map((bucket) => ({ at: bucket.at, p95_ms: numOrNull(bucket.p95_ms), checks: Number(bucket.checks ?? 0) })),
    monitors: (raw.monitors ?? []).map((monitor) => ({ monitor_id: monitor.monitor_id, p50_ms: numOrNull(monitor.p50_ms), p95_ms: numOrNull(monitor.p95_ms), checks: Number(monitor.checks ?? 0) })),
    components: (raw.components ?? []).map((component) => ({ component_id: component.component_id, p95_ms: numOrNull(component.p95_ms), checks: Number(component.checks ?? 0) })),
  }
}

// ------------------------------------------------------------------ CSV
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One CSV cell (RFC 4180): quoted when it contains a comma, quote, CR or LF, or leading/trailing spaces; quotes
 * doubled. Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR) gets a leading apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  let text = value instanceof Date ? value.toISOString() : String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV document with CRLF line endings and a trailing newline. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

const minutes = (seconds: number | null | undefined) => (seconds === null || seconds === undefined ? null : Math.round((seconds / 60) * 10) / 10)

export function uptimeCsv(metrics: ProjectMetrics): string {
  return toCsv(
    ['component', 'key', 'current_status', 'uptime_percent', 'weighted_downtime_minutes', 'major_outage_minutes', 'partial_outage_minutes', 'degraded_minutes', 'maintenance_minutes', 'from', 'to'],
    [
      ...metrics.components.map((component) => [
        component.name,
        component.slug,
        component.status,
        component.uptime,
        minutes(component.downtime_seconds),
        minutes(component.major_seconds),
        minutes(component.partial_seconds),
        minutes(component.degraded_seconds),
        minutes(component.maintenance_seconds),
        metrics.from,
        metrics.to,
      ]),
      ['All components', '', '', metrics.uptime, null, null, null, null, null, metrics.from, metrics.to],
    ],
  )
}

export interface IncidentTimings {
  /** Detection → acknowledgement. */
  acknowledge_seconds: number | null
  /** Detection → resolution (resolved incidents only). */
  resolve_seconds: number | null
  /** Publication (or detection) → resolution, or → end of the period while open: how long customers saw it. */
  duration_seconds: number
}

export function incidentTimings(
  incident: Pick<ProjectMetrics['incidents']['list'][number], 'detected_at' | 'acknowledged_at' | 'resolved_at'>,
  publishedAt: string | null,
  periodEnd: string | Date,
): IncidentTimings {
  const detected = new Date(incident.detected_at).getTime()
  const seconds = (later: string | null) => (later ? Math.max(0, (new Date(later).getTime() - detected) / 1000) : null)
  const start = new Date(publishedAt ?? incident.detected_at).getTime()
  const end = incident.resolved_at ? new Date(incident.resolved_at).getTime() : new Date(periodEnd).getTime()
  return {
    acknowledge_seconds: seconds(incident.acknowledged_at),
    resolve_seconds: seconds(incident.resolved_at),
    duration_seconds: Math.max(0, (end - start) / 1000),
  }
}

export function incidentsCsv(metrics: ProjectMetrics, publishedAt: Record<string, string | null> = {}): string {
  return toCsv(
    ['id', 'title', 'impact', 'status', 'detected_at', 'published_at', 'acknowledged_at', 'resolved_at', 'time_to_acknowledge_minutes', 'time_to_resolve_minutes', 'public_duration_minutes'],
    metrics.incidents.list.map((incident) => {
      const published = publishedAt[incident.id] ?? null
      const timings = incidentTimings(incident, published, metrics.to)
      return [
        incident.id,
        incident.title,
        incident.impact,
        incident.status,
        incident.detected_at,
        published,
        incident.acknowledged_at,
        incident.resolved_at,
        minutes(timings.acknowledge_seconds),
        minutes(timings.resolve_seconds),
        minutes(timings.duration_seconds),
      ]
    }),
  )
}

export const CSV_EXPORT_KINDS = ['uptime', 'incidents'] as const
export type CsvExportKind = (typeof CSV_EXPORT_KINDS)[number]

/** CSV of the uptime table or the incident list for a range (viewer and up). */
export async function exportReportCsv(ctx: DomainContext, projectRef: string, query: MetricsQuery, kind: CsvExportKind): Promise<{ filename: string; csv: string }> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const { from, to } = resolveMetricsRange(query)
  const metrics = await projectMetrics(ctx, access.project.id, from, to)
  const day = (date: Date) => date.toISOString().slice(0, 10)
  const filename = `upvane-${access.project.slug}-${kind}-${day(from)}-to-${day(to)}.csv`
  if (kind === 'incidents') {
    const published = await incidentPublishedAt(ctx, access.project.id, metrics.incidents.list.map((incident) => incident.id))
    return { filename, csv: incidentsCsv(metrics, published) }
  }
  return { filename, csv: uptimeCsv(metrics) }
}

/** published_at for the incidents of a metrics list (the SQL list does not carry it). */
export async function incidentPublishedAt(ctx: DomainContext, projectId: string, ids: string[]): Promise<Record<string, string | null>> {
  if (ids.length === 0) return {}
  const { data, error } = await ctx.db.from('incidents').select('id, published_at').eq('project_id', projectId).in('id', ids)
  if (error) throw fromDatabaseError(error)
  return Object.fromEntries(((data ?? []) as Array<{ id: string; published_at: string | null }>).map((row) => [row.id, row.published_at]))
}
