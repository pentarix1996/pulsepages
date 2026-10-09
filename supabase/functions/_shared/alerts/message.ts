// Turns an alert event into a channel-neutral AlertMessage.
import { ALERT_EVENT_LABELS, INCIDENT_IMPACT_LABELS, INCIDENT_STATUS_LABELS, MAINTENANCE_STATUS_LABELS, MONITOR_TYPE_LABELS, isComponentStatus, statusLabel } from '../domain.ts'
import type { AlertEventType, IncidentImpact, IncidentStatus, MaintenanceStatus, MonitorType } from '../domain.ts'
import { regionLabel } from '../regions.ts'
import type { AlertEventRow, AlertField, AlertMessage, AlertTone, LinkContext, ProjectContext } from './types.ts'

export const TONE_COLORS: Record<AlertTone, string> = {
  problem: '#F0525D',
  warning: '#F4B740',
  recovery: '#34D39A',
  info: '#5B58E8',
  maintenance: '#5E9BFF',
}

function joinUrl(base: string, path: string | null | undefined): string | null {
  if (!path) return null
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/** Public status page URL for a project, honouring a verified custom domain. `subPath` is relative to the page root. */
export function statusPageUrl(project: Pick<ProjectContext, 'organization_slug' | 'slug' | 'custom_domain'>, links: LinkContext, subPath = ''): string {
  const suffix = subPath ? (subPath.startsWith('/') ? subPath : `/${subPath}`) : ''
  if (project.custom_domain) return `https://${project.custom_domain}${suffix}`
  return `${links.appUrl.replace(/\/+$/, '')}/status/${project.organization_slug}/${project.slug}${suffix}`
}

function statusPagePathToUrl(path: string | undefined, project: ProjectContext, links: LinkContext): string | null {
  if (!path) return statusPageUrl(project, links)
  const prefix = `/status/${project.organization_slug}/${project.slug}`
  const subPath = path.startsWith(prefix) ? path.slice(prefix.length) : ''
  return statusPageUrl(project, links, subPath)
}

function formatDateTime(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function names(list: Array<{ name: string }> | undefined): string {
  return (list ?? []).map((item) => item.name).join(', ')
}

export function buildAlertMessage(event: AlertEventRow, project: ProjectContext, links: LinkContext): AlertMessage {
  const payload = event.payload ?? {}
  const type = event.type as AlertEventType
  const fields: AlertField[] = []
  let title = payload.reason ?? ALERT_EVENT_LABELS[type] ?? 'Upvane alert'
  let summary = payload.reason ?? ''
  let tone: AlertTone = 'info'
  let severity: AlertMessage['severity'] = 'info'
  let isResolution = false
  let dedupKey = event.dedupe_key ?? `${type}:${event.id}`
  let dashboardLabel = 'Open in Upvane'

  switch (type) {
    case 'component_status_worsened':
    case 'component_recovered': {
      const component = payload.component
      const current = component?.current_status ?? payload.status
      const previous = component?.previous_status
      isResolution = type === 'component_recovered'
      tone = isResolution ? 'recovery' : current === 'major_outage' ? 'problem' : 'warning'
      severity = isResolution ? 'info' : current === 'major_outage' ? 'critical' : current === 'partial_outage' ? 'error' : 'warning'
      title = isResolution ? `${component?.name ?? 'A component'} is operational again` : `${component?.name ?? 'A component'}: ${statusLabel(current).toLowerCase()}`
      summary = payload.reason ?? ''
      if (previous && isComponentStatus(previous)) fields.push({ label: 'Previous status', value: statusLabel(previous) })
      if (current && isComponentStatus(current)) fields.push({ label: 'Status', value: statusLabel(current) })
      if (component?.source) fields.push({ label: 'Source', value: component.source })
      dedupKey = `component:${component?.id ?? event.source_id}`
      break
    }
    case 'monitor_down':
    case 'monitor_degraded':
    case 'monitor_recovered': {
      const monitor = payload.monitor
      isResolution = type === 'monitor_recovered'
      tone = isResolution ? 'recovery' : type === 'monitor_down' ? 'problem' : 'warning'
      severity = isResolution ? 'info' : type === 'monitor_down' ? 'critical' : 'warning'
      title = isResolution ? `${monitor?.name ?? 'Monitor'} recovered` : `${monitor?.name ?? 'Monitor'} is ${type === 'monitor_down' ? 'down' : 'degraded'}`
      summary = monitor?.last_error && !isResolution ? monitor.last_error : payload.reason ?? ''
      if (monitor?.target) fields.push({ label: 'Target', value: monitor.target })
      if (monitor?.type) fields.push({ label: 'Check', value: MONITOR_TYPE_LABELS[monitor.type as MonitorType] ?? monitor.type })
      const regions = monitor?.last_result && typeof monitor.last_result === 'object' ? (monitor.last_result as { regions?: Record<string, string> }).regions : undefined
      if (regions && Object.keys(regions).length > 0) {
        fields.push({ label: 'Regions', value: Object.entries(regions).map(([region, status]) => `${regionLabel(region)} ${status}`).join(', ') })
      }
      if (payload.components && payload.components.length > 0) fields.push({ label: 'Components', value: names(payload.components) })
      if (payload.draft_incident_path) {
        fields.push({ label: 'Draft incident', value: 'A draft incident is ready to publish.' })
      }
      dedupKey = `monitor:${monitor?.id ?? event.source_id}`
      if (payload.draft_incident_path && !isResolution) dashboardLabel = 'Review the draft incident'
      break
    }
    case 'tls_expiring': {
      const monitor = payload.monitor
      tone = 'warning'
      severity = 'warning'
      title = `Certificate for ${monitor?.target ?? monitor?.name ?? 'a monitor'} expires soon`
      summary = payload.reason ?? ''
      if (monitor?.tls_expires_at) fields.push({ label: 'Expires', value: formatDateTime(monitor.tls_expires_at) })
      dedupKey = `tls:${monitor?.id ?? event.source_id}`
      break
    }
    case 'incident_created':
    case 'incident_updated':
    case 'incident_resolved':
    case 'incident_draft_created': {
      const incident = payload.incident
      const impact = (incident?.impact ?? payload.severity ?? 'minor') as IncidentImpact
      isResolution = type === 'incident_resolved'
      tone = isResolution ? 'recovery' : type === 'incident_draft_created' ? 'warning' : impact === 'critical' || impact === 'major' ? 'problem' : 'warning'
      severity = isResolution ? 'info' : impact === 'critical' ? 'critical' : impact === 'major' ? 'error' : 'warning'
      const prefix = type === 'incident_created' ? 'Incident declared' : type === 'incident_updated' ? 'Incident update' : type === 'incident_resolved' ? 'Resolved' : 'Draft incident'
      title = `${prefix}: ${incident?.title ?? 'Incident'}`
      summary = payload.message ?? payload.reason ?? ''
      if (incident?.status) fields.push({ label: 'Status', value: INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status })
      fields.push({ label: 'Impact', value: INCIDENT_IMPACT_LABELS[impact] ?? impact })
      const affected = incident?.components ?? []
      if (affected.length > 0) {
        fields.push({ label: 'Components', value: affected.map((item) => `${item.name} (${statusLabel(item.status, true).toLowerCase()})`).join(', ') })
      }
      dedupKey = `incident:${incident?.id ?? event.source_id}`
      dashboardLabel = type === 'incident_draft_created' ? 'Review the draft' : 'Open the incident'
      break
    }
    case 'maintenance_scheduled':
    case 'maintenance_reminder':
    case 'maintenance_started':
    case 'maintenance_completed':
    case 'maintenance_cancelled': {
      const maintenance = payload.maintenance
      tone = type === 'maintenance_completed' ? 'recovery' : 'maintenance'
      severity = 'info'
      isResolution = type === 'maintenance_completed' || type === 'maintenance_cancelled'
      const prefix = {
        maintenance_scheduled: 'Maintenance scheduled',
        maintenance_reminder: 'Maintenance starts soon',
        maintenance_started: 'Maintenance started',
        maintenance_completed: 'Maintenance completed',
        maintenance_cancelled: 'Maintenance cancelled',
      }[type]
      title = `${prefix}: ${maintenance?.title ?? 'Maintenance'}`
      summary = maintenance?.description || payload.reason || ''
      if (maintenance?.scheduled_start) fields.push({ label: 'Window', value: `${formatDateTime(maintenance.scheduled_start)} → ${formatDateTime(maintenance.scheduled_end)}` })
      if (maintenance?.status) fields.push({ label: 'Status', value: MAINTENANCE_STATUS_LABELS[maintenance.status as MaintenanceStatus] ?? maintenance.status })
      if (maintenance?.components && maintenance.components.length > 0) fields.push({ label: 'Components', value: names(maintenance.components) })
      dedupKey = `maintenance:${maintenance?.id ?? event.source_id}`
      break
    }
    case 'test': {
      tone = 'info'
      severity = 'info'
      title = 'Test alert from Upvane'
      summary = payload.reason ?? 'This channel is connected. Real alerts will look like this.'
      dedupKey = `test:${event.id}`
      break
    }
    default:
      break
  }

  const statusPageLink = type.startsWith('incident_') && type !== 'incident_draft_created'
    ? statusPagePathToUrl(payload.status_page_path, project, links)
    : type.startsWith('maintenance_')
      ? statusPagePathToUrl(payload.status_page_path, project, links)
      : null

  const dashboardPath = payload.draft_incident_path ?? payload.dashboard_path ?? `/p/${project.id}/overview`

  return {
    eventId: event.id,
    eventType: type,
    title: truncate(title, 200),
    summary: truncate(summary, 1500),
    tone,
    color: TONE_COLORS[tone],
    fields,
    projectName: payload.project_name ?? project.name,
    occurredAt: payload.occurred_at ?? event.created_at,
    dashboardUrl: joinUrl(links.appUrl, dashboardPath),
    dashboardLabel,
    statusPageUrl: statusPageLink,
    dedupKey: `upvane:${project.id}:${dedupKey}`,
    isResolution,
    severity,
  }
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
