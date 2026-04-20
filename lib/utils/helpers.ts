import type { ComponentStatus, Component, IncidentSeverity, Incident } from '@/lib/types'

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
  if (severity === 'danger') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'info'
}
