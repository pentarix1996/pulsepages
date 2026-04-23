import type { ComponentStatus, Component, IncidentSeverity, Incident } from '@/lib/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return formatDate(date)
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

const STATUS_LABELS: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded Performance',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  maintenance: 'Under Maintenance',
}

export function getStatusLabel(status: ComponentStatus): string {
  return STATUS_LABELS[status] || 'Unknown'
}

const STATUS_COLORS: Record<ComponentStatus, string> = {
  operational: 'success',
  degraded: 'warning',
  partial_outage: 'warning',
  major_outage: 'danger',
  maintenance: 'info',
}

export function getStatusColor(status: ComponentStatus): string {
  return STATUS_COLORS[status] || 'neutral'
}

const STATUS_DOT_CLASSES: Record<ComponentStatus, string> = {
  operational: 'status-dot-operational',
  degraded: 'status-dot-degraded',
  partial_outage: 'status-dot-down',
  major_outage: 'status-dot-down',
  maintenance: 'status-dot-maintenance',
}

export function getStatusDotClass(status: ComponentStatus): string {
  return STATUS_DOT_CLASSES[status] || ''
}

export function getOverallStatus(components: Component[]): ComponentStatus {
  if (!components || components.length === 0) return 'operational'
  const statuses = components.map((c) => c.status)
  if (statuses.includes('major_outage')) return 'major_outage'
  if (statuses.includes('partial_outage')) return 'partial_outage'
  if (statuses.includes('degraded')) return 'degraded'
  if (statuses.includes('maintenance')) return 'maintenance'
  return 'operational'
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text)
  }
  return Promise.resolve()
}

export function getSeverityBadgeVariant(
  status: string,
  severity: IncidentSeverity
): 'success' | 'danger' | 'warning' | 'info' {
  if (status === 'resolved') return 'success'
  if (severity === 'critical') return 'danger'
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  return 'info'
}

// Severity ranking (higher = worse)
const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

// ComponentStatus ranking (higher = worse)
const STATUS_RANK: Record<ComponentStatus, number> = {
  major_outage: 5,
  partial_outage: 4,
  degraded: 3,
  maintenance: 2,
  operational: 1,
}

// Severity to ComponentStatus mapping for auto-update
const SEVERITY_TO_STATUS: Record<IncidentSeverity, ComponentStatus> = {
  critical: 'major_outage',
  high: 'partial_outage',
  medium: 'degraded',
  low: 'degraded',
}

export function getComponentStatusFromSeverity(severity: IncidentSeverity): ComponentStatus {
  return SEVERITY_TO_STATUS[severity]
}

/**
 * Returns the worse (higher severity) of two statuses.
 * Used to ensure we never downgrade component status based on lower-severity incidents.
 */
export function getWorseStatus(a: ComponentStatus, b: ComponentStatus): ComponentStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b
}

/**
 * Returns the worse (higher severity) of two severities.
 */
export function getWorseSeverity(a: IncidentSeverity, b: IncidentSeverity): IncidentSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

/**
 * Gets the status that represents the highest severity active incident
 * among the given incidents for the specified component.
 */
export function getHighestSeverityStatus(
  incidents: Incident[],
  componentId: string
): ComponentStatus | null {
  let worstSeverity: IncidentSeverity | null = null

  for (const inc of incidents) {
    // Skip resolved or maintenance incidents
    if (inc.status === 'resolved' || inc.status === 'maintenance') continue
    // Check if this incident affects the component
    if (!inc.component_ids.includes(componentId)) continue

    if (!worstSeverity) {
      worstSeverity = inc.severity
    } else {
      worstSeverity = getWorseSeverity(worstSeverity, inc.severity)
    }
  }

  return worstSeverity ? getComponentStatusFromSeverity(worstSeverity) : null
}

// ---------------------------------------------------------------------------
// Real Uptime Metrics
// ---------------------------------------------------------------------------

export const UPTIME_HISTORY_DAYS = parseInt(process.env.NEXT_PUBLIC_UPTIME_HISTORY_DAYS || '60', 10)

/**
 * Returns true for statuses that count as downtime for uptime calculation.
 * Maintenance is NOT counted as downtime (scheduled, not unplanned).
 */
export function isDowntimeStatus(status: string): boolean {
  return ['degraded', 'partial_outage', 'major_outage'].includes(status)
}

/**
 * Inserts a status history record ONLY when the status actually changed.
 * Fetches the current latest status and compares before inserting.
 *
 * @returns The inserted record ID, or null if no insert occurred (status unchanged)
 */
export async function insertStatusHistoryIfChanged(
  supabase: SupabaseClient,
  componentId: string,
  newStatus: string,
  reason: 'incident' | 'manual' | 'maintenance' | 'incident_resolved',
  incidentId?: string
): Promise<string | null> {
  const { data: last } = await supabase
    .from('component_status_history')
    .select('status')
    .eq('component_id', componentId)
    .order('changed_at', { ascending: false })
    .limit(1)
    .single()

  // No history yet — assume operational, so any non-operational is a change
  const currentStatus = last?.status || 'operational'

  if (currentStatus !== newStatus) {
    const { data, error } = await supabase
      .from('component_status_history')
      .insert({
        component_id: componentId,
        status: newStatus,
        reason,
        incident_id: incidentId || null,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[insertStatusHistoryIfChanged] failed:', error.message)
      return null
    }
    return data?.id || null
  }

  return null
}

/**
 * Calculate uptime percentage for a component based on its status history.
 * Returns a string formatted as "99.93" (2 decimal places).
 *
 * Algorithm:
 * - Build a timeline from history records (status + start/end time)
 * - Sum durations where status is a downtime status
 * - Use now() as end time for the last record (active period)
 * - Edge cases: no history → 100.00, all operational → 100.00
 */
export async function calculateUptimeFromHistory(
  supabase: SupabaseClient,
  componentId: string,
  days: number = UPTIME_HISTORY_DAYS
): Promise<string> {
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)

  const { data: history, error } = await supabase
    .from('component_status_history')
    .select('status, changed_at')
    .eq('component_id', componentId)
    .gte('changed_at', startDate.toISOString())
    .order('changed_at', { ascending: true })

  if (error) {
    console.error('[calculateUptimeFromHistory] query failed:', error.message)
    return '100.00'
  }

  if (!history || history.length === 0) return '100.00'

  let totalMs = endDate.getTime() - startDate.getTime()
  let downtimeMs = 0

  for (let i = 0; i < history.length; i++) {
    const record = history[i]
    const nextTime = i === history.length - 1
      ? endDate.getTime()
      : new Date(history[i + 1].changed_at).getTime()
    const startTime = new Date(record.changed_at).getTime()
    const duration = nextTime - startTime

    if (isDowntimeStatus(record.status)) {
      downtimeMs += duration
    }
  }

  const uptime = Math.max(0, 100 - (downtimeMs / totalMs * 100))
  return uptime.toFixed(2)
}

/**
 * @deprecated Use `calculateUptimeFromHistory` instead. This function uses
 * incident duration with a 30-minute fallback, which is not accurate.
 * Kept for backward compatibility with existing tests.
 */
export function uptimePercentage(incidents: Incident[], days = 90): string {
  if (!incidents || incidents.length === 0) return '100.00'
  const now = Date.now()
  const startDate = now - days * 24 * 60 * 60 * 1000
  const recentIncidents = incidents.filter(
    (i) => new Date(i.created_at).getTime() > startDate
  )
  const totalMinutes = days * 24 * 60
  const downtimeMinutes = recentIncidents.reduce((sum, i) => sum + (i.duration || 30), 0)
  const uptime = ((totalMinutes - downtimeMinutes) / totalMinutes) * 100
  return Math.max(0, uptime).toFixed(2)
}