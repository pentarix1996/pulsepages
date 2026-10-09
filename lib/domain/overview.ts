import 'server-only'
import { ACTIVE_INCIDENT_STATUSES, hasRole, impactRank, type ComponentStatus, type IncidentImpact, type IncidentStatus, type MaintenanceStatus, type MonitorState, type MonitorType, type OrgRole, type StatusSource } from '@shared/domain.ts'
import type { Plan } from '@shared/plans.ts'
import { requireProject } from './access'
import type { DomainContext } from './context'
import { unwrap } from './errors'
import { metricsForRange, projectLatency, projectUptimeDetail, type UptimeDayDetail } from './metrics'
import { projectStatusPageUrl } from './projects'

const DAY_MS = 86_400_000
const CHECKLIST_DAYS = 14

export interface OverviewIncident {
  id: string
  title: string
  status: IncidentStatus
  impact: IncidentImpact
  source: string
  detected_at: string
  started_at: string
  latest_update: { message: string; status: IncidentStatus | null; created_at: string } | null
  components: string[]
}

export interface OverviewMaintenance {
  id: string
  title: string
  description: string
  status: MaintenanceStatus
  scheduled_start: string
  scheduled_end: string
  actual_start: string | null
  mute_alerts: boolean
  notify_subscribers: boolean
  reminder_minutes: number
  components: string[]
}

export interface OverviewMonitorRef {
  id: string
  name: string
  type: MonitorType
  state: MonitorState
}

export interface OverviewComponent {
  id: string
  name: string
  slug: string
  status: ComponentStatus
  status_source: StatusSource
  pinned: boolean
  uptime: number | null
  days: UptimeDayDetail[]
  p95_ms: number | null
  monitors: OverviewMonitorRef[]
  href: string
}

export interface OverviewGroup {
  id: string | null
  name: string | null
  components: OverviewComponent[]
}

export interface OverviewCheck {
  id: string
  checked_at: string
  region: string | null
  monitor_id: string | null
  monitor_name: string
  monitor_type: MonitorType | null
  status: string
  http_status: number | null
  response_time_ms: number | null
  error_message: string | null
}

export interface ChecklistItem {
  key: 'components' | 'monitors' | 'alerts' | 'share'
  label: string
  description: string
  done: boolean
  href: string
  action: string
}

export interface OverviewData {
  project: {
    id: string
    name: string
    slug: string
    timezone: string
    visibility: 'public' | 'private'
    status_page_url: string
    custom_domain: string | null
    custom_domain_status: string
    created_at: string
  }
  organization: { id: string; name: string; slug: string; plan: Plan }
  role: OrgRole
  generated_at: string
  incidents: OverviewIncident[]
  drafts: Array<{ id: string; title: string; source: string; detected_at: string }>
  maintenance: { in_progress: OverviewMaintenance[]; upcoming: OverviewMaintenance[] }
  kpis: {
    uptime: number | null
    slo: { name: string; target: number; window_days: number; budget_remaining: number; allowed_downtime_seconds: number; consumed_downtime_seconds: number } | null
    open_incidents: { count: number; worst_impact: IncidentImpact | null; oldest_started_at: string | null }
    mttr: { current: number | null; previous: number | null; resolved: number }
    monitors: { total: number; passing: number; pending: number; paused: number; failing: OverviewMonitorRef[]; min_interval_seconds: number | null }
    latency: { p95_ms: number | null; checks: number; sparkline: number[]; rising: boolean }
  }
  groups: OverviewGroup[]
  components_total: number
  checks: OverviewCheck[]
  status_page: { subscribers: { email: number; slack: number; webhook: number } | null }
  checklist: { items: ChecklistItem[]; done: number } | null
}

interface MonitorRow {
  id: string
  name: string
  type: MonitorType
  state: MonitorState
  enabled: boolean
  paused_reason: string | null
  interval_seconds: number
  monitor_components: Array<{ component_id: string }> | null
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Everything /p/[projectId]/overview shows, read in parallel: incidents and maintenance in progress, KPIs (30-day
 * uptime and SLO budget, MTTR against the previous 30 days, monitors, 24 h p95), components with 90-day bars, the
 * latest checks and the status page card.
 */
export async function getOverview(ctx: DomainContext, projectRef: string, options: { now?: Date; checklistHidden?: boolean } = {}): Promise<OverviewData> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const project = access.project
  const projectId = project.id
  const now = options.now ?? new Date()
  const isAdmin = hasRole(access.role, 'admin')
  const base = `/p/${projectId}`

  const subscriberCount = (type: 'email' | 'slack' | 'webhook') =>
    ctx.db.from('status_page_subscribers').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('type', type).not('confirmed_at', 'is', null)

  const [
    componentsResult,
    groupsResult,
    monitorsResult,
    incidentsResult,
    maintenancesResult,
    checksResult,
    previousResult,
    channelsResult,
    metrics,
    uptime,
    latency,
    subscribers,
  ] = await Promise.all([
    ctx.db.from('components').select('id, name, slug, status, status_source, manual_status, group_id, position').eq('project_id', projectId).order('position').order('name'),
    ctx.db.from('component_groups').select('id, name, position').eq('project_id', projectId).order('position').order('name'),
    ctx.db.from('monitors').select('id, name, type, state, enabled, paused_reason, interval_seconds, monitor_components(component_id)').eq('project_id', projectId).order('name'),
    ctx.db
      .from('incidents')
      .select('id, title, status, impact, source, detected_at, published_at, created_at, incident_components(component_id)')
      .eq('project_id', projectId)
      .in('status', ['draft', ...ACTIVE_INCIDENT_STATUSES])
      .is('deleted_at', null)
      .order('detected_at', { ascending: true }),
    ctx.db
      .from('maintenances')
      .select('id, title, description, status, scheduled_start, scheduled_end, actual_start, mute_alerts, notify_subscribers, reminder_minutes, maintenance_components(component_id)')
      .eq('project_id', projectId)
      .in('status', ['scheduled', 'in_progress'])
      .order('scheduled_start', { ascending: true })
      .limit(20),
    ctx.db
      .from('monitor_check_results')
      .select('id, monitor_id, region, status, http_status, response_time_ms, error_message, checked_at')
      .eq('project_id', projectId)
      .not('monitor_id', 'is', null)
      .order('checked_at', { ascending: false })
      .limit(10),
    ctx.db
      .from('incidents')
      .select('detected_at, resolved_at')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .neq('status', 'draft')
      .not('resolved_at', 'is', null)
      .gte('detected_at', new Date(now.getTime() - 60 * DAY_MS).toISOString())
      .lt('detected_at', new Date(now.getTime() - 30 * DAY_MS).toISOString()),
    ctx.db.from('alert_channels').select('type, enabled').eq('project_id', projectId),
    metricsForRange(ctx, access, new Date(now.getTime() - 30 * DAY_MS), now),
    projectUptimeDetail(ctx, projectId, 90),
    projectLatency(ctx, projectId, new Date(now.getTime() - DAY_MS), now, 60),
    isAdmin ? Promise.all([subscriberCount('email'), subscriberCount('slack'), subscriberCount('webhook')]) : Promise.resolve(null),
  ])

  const components = unwrap(componentsResult) as Array<{ id: string; name: string; slug: string; status: ComponentStatus; status_source: StatusSource; manual_status: ComponentStatus | null; group_id: string | null; position: number }>
  const groups = unwrap(groupsResult) as Array<{ id: string; name: string; position: number }>
  const monitors = unwrap(monitorsResult) as unknown as MonitorRow[]
  const componentName = new Map(components.map((component) => [component.id, component.name]))
  const monitorById = new Map(monitors.map((monitor) => [monitor.id, monitor]))

  // ---- incidents
  const incidentRows = unwrap(incidentsResult) as unknown as Array<{
    id: string
    title: string
    status: IncidentStatus
    impact: IncidentImpact
    source: string
    detected_at: string
    published_at: string | null
    created_at: string
    incident_components: Array<{ component_id: string }> | null
  }>
  const active = incidentRows.filter((incident) => incident.status !== 'draft')
  const latestUpdates = new Map<string, { message: string; status: IncidentStatus | null; created_at: string }>()
  if (active.length > 0) {
    const updates = unwrap(
      await ctx.db
        .from('incident_updates')
        .select('incident_id, message, status, created_at')
        .in('incident_id', active.map((incident) => incident.id))
        .eq('visibility', 'public')
        .eq('kind', 'update')
        .order('created_at', { ascending: false }),
    ) as Array<{ incident_id: string; message: string; status: IncidentStatus | null; created_at: string }>
    for (const update of updates) if (!latestUpdates.has(update.incident_id)) latestUpdates.set(update.incident_id, update)
  }
  const incidents: OverviewIncident[] = active
    .map((incident) => ({
      id: incident.id,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
      source: incident.source,
      detected_at: incident.detected_at,
      started_at: incident.published_at ?? incident.detected_at,
      latest_update: latestUpdates.get(incident.id) ?? null,
      components: (incident.incident_components ?? []).map((link) => componentName.get(link.component_id)).filter((value): value is string => Boolean(value)),
    }))
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || a.detected_at.localeCompare(b.detected_at))
  const drafts = incidentRows.filter((incident) => incident.status === 'draft').map(({ id, title, source, detected_at }) => ({ id, title, source, detected_at }))

  // ---- maintenance
  const maintenanceRows = unwrap(maintenancesResult) as unknown as Array<Omit<OverviewMaintenance, 'components'> & { maintenance_components: Array<{ component_id: string }> | null }>
  const toMaintenance = ({ maintenance_components, ...row }: (typeof maintenanceRows)[number]): OverviewMaintenance => ({
    ...row,
    components: (maintenance_components ?? []).map((link) => componentName.get(link.component_id)).filter((value): value is string => Boolean(value)),
  })
  const inProgress = maintenanceRows.filter((row) => row.status === 'in_progress').map(toMaintenance)
  const upcoming = maintenanceRows.filter((row) => row.status === 'scheduled' && new Date(row.scheduled_end).getTime() > now.getTime()).slice(0, 3).map(toMaintenance)

  // ---- KPIs
  const slo = metrics.slos.find((item) => item.component_id === null && item.window_days === 30) ?? metrics.slos.find((item) => item.component_id === null) ?? metrics.slos[0] ?? null
  const previous = unwrap(previousResult) as Array<{ detected_at: string; resolved_at: string }>
  const previousMttr = mean(
    previous
      .map((incident) => (new Date(incident.resolved_at).getTime() - new Date(incident.detected_at).getTime()) / 1000)
      .filter((seconds) => seconds >= 0),
  )
  const resolvedCount = metrics.incidents.list.filter((incident) => incident.resolved_at).length

  const activeMonitors = monitors.filter((monitor) => monitor.enabled && !monitor.paused_reason && monitor.state !== 'paused')
  const failing = activeMonitors.filter((monitor) => monitor.state === 'down' || monitor.state === 'degraded').map(({ id, name, type, state }) => ({ id, name, type, state }))
  const intervals = activeMonitors.map((monitor) => monitor.interval_seconds).filter((value) => value > 0)

  const sparkline = latency.buckets.map((bucket) => bucket.p95_ms).filter((value): value is number => value !== null)
  const recent = mean(sparkline.slice(-3))
  const rising = latency.p95_ms !== null && recent !== null && sparkline.length >= 6 && recent > latency.p95_ms * 1.2

  // ---- components with bars, uptime, p95 and monitors
  const uptimeById = new Map(uptime.components.map((component) => [component.component_id, component]))
  const latencyByComponent = new Map(latency.components.map((component) => [component.component_id, component.p95_ms]))
  const monitorsByComponent = new Map<string, OverviewMonitorRef[]>()
  for (const monitor of monitors) {
    for (const link of monitor.monitor_components ?? []) {
      const list = monitorsByComponent.get(link.component_id) ?? []
      list.push({ id: monitor.id, name: monitor.name, type: monitor.type, state: monitor.enabled && !monitor.paused_reason ? monitor.state : 'paused' })
      monitorsByComponent.set(link.component_id, list)
    }
  }
  const toComponent = (component: (typeof components)[number]): OverviewComponent => {
    const detail = uptimeById.get(component.id)
    const linked = monitorsByComponent.get(component.id) ?? []
    return {
      id: component.id,
      name: component.name,
      slug: component.slug,
      status: component.status,
      status_source: component.status_source,
      pinned: component.manual_status !== null,
      uptime: detail ? detail.uptime : null,
      days: detail?.days ?? [],
      p95_ms: latencyByComponent.get(component.id) ?? null,
      monitors: linked,
      href: linked.length > 0 ? `${base}/monitors/${linked[0]!.id}` : `${base}/components`,
    }
  }
  const knownGroups = new Set(groups.map((group) => group.id))
  const grouped: OverviewGroup[] = groups.map((group) => ({ id: group.id, name: group.name, components: components.filter((component) => component.group_id === group.id).map(toComponent) }))
  const ungrouped = components.filter((component) => !component.group_id || !knownGroups.has(component.group_id)).map(toComponent)
  if (ungrouped.length > 0) grouped.push({ id: null, name: groups.length > 0 ? 'Other components' : null, components: ungrouped })

  // ---- live checks
  const checkRows = unwrap(checksResult) as Array<{ id: string; monitor_id: string | null; region: string | null; status: string; http_status: number | null; response_time_ms: number | null; error_message: string | null; checked_at: string }>
  const checks: OverviewCheck[] = checkRows.map((row) => {
    const monitor = row.monitor_id ? monitorById.get(row.monitor_id) : undefined
    return { ...row, monitor_name: monitor?.name ?? 'Deleted monitor', monitor_type: monitor?.type ?? null }
  })

  // ---- status page and onboarding
  const subscriberCounts = subscribers ? { email: subscribers[0].count ?? 0, slack: subscribers[1].count ?? 0, webhook: subscribers[2].count ?? 0 } : null
  const channels = unwrap(channelsResult) as Array<{ type: string; enabled: boolean }>
  let checklist: OverviewData['checklist'] = null
  if (isAdmin && !options.checklistHidden) {
    const items: ChecklistItem[] = [
      { key: 'components', label: 'Add components', description: 'List the services customers depend on, such as API, Dashboard or Webhooks.', done: components.length > 0, href: `${base}/components?new=1`, action: 'Add component' },
      { key: 'monitors', label: 'Add a monitor', description: 'Check an endpoint from several regions so status updates on its own.', done: monitors.length > 0, href: `${base}/monitors?new=1`, action: 'Create monitor' },
      { key: 'alerts', label: 'Connect an alert channel', description: 'Send alerts to Slack, Teams, PagerDuty, Opsgenie or a webhook, not just email.', done: channels.some((channel) => channel.enabled && channel.type !== 'email'), href: `${base}/alerts`, action: 'Connect a channel' },
      { key: 'share', label: 'Share the page', description: 'Link it from your app and docs so customers can subscribe to updates.', done: Boolean(project.custom_domain) || (subscriberCounts ? subscriberCounts.email + subscriberCounts.slack + subscriberCounts.webhook > 0 : false), href: `${base}/status-page`, action: 'Status page settings' },
    ]
    const done = items.filter((item) => item.done).length
    const isNew = now.getTime() - new Date(project.created_at).getTime() < CHECKLIST_DAYS * DAY_MS || components.length === 0 || monitors.length === 0
    if (done < items.length && isNew) checklist = { items, done }
  }

  const oldest = incidents.reduce<string | null>((value, incident) => (value === null || incident.started_at < value ? incident.started_at : value), null)
  const worstImpact = incidents.reduce<IncidentImpact | null>((value, incident) => (value === null || impactRank(incident.impact) > impactRank(value) ? incident.impact : value), null)

  return {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      timezone: project.timezone || 'UTC',
      visibility: project.visibility,
      status_page_url: projectStatusPageUrl(project, access.organization.slug),
      custom_domain: project.custom_domain,
      custom_domain_status: project.custom_domain_status,
      created_at: project.created_at,
    },
    organization: { id: access.organization.id, name: access.organization.name, slug: access.organization.slug, plan: access.organization.plan },
    role: access.role,
    generated_at: now.toISOString(),
    incidents,
    drafts,
    maintenance: { in_progress: inProgress, upcoming },
    kpis: {
      uptime: components.length > 0 ? metrics.uptime : null,
      slo: slo ? { name: slo.name, target: slo.target, window_days: slo.window_days, budget_remaining: slo.budget_remaining, allowed_downtime_seconds: slo.allowed_downtime_seconds, consumed_downtime_seconds: slo.consumed_downtime_seconds } : null,
      open_incidents: { count: incidents.length, worst_impact: worstImpact, oldest_started_at: oldest },
      mttr: { current: metrics.incidents.mttr_seconds, previous: previousMttr, resolved: resolvedCount },
      monitors: {
        total: activeMonitors.length,
        passing: activeMonitors.filter((monitor) => monitor.state === 'up').length,
        pending: activeMonitors.filter((monitor) => monitor.state === 'pending').length,
        paused: monitors.length - activeMonitors.length,
        failing,
        min_interval_seconds: intervals.length > 0 ? Math.min(...intervals) : null,
      },
      latency: { p95_ms: latency.p95_ms, checks: latency.checks, sparkline, rising },
    },
    groups: grouped,
    components_total: components.length,
    checks,
    status_page: { subscribers: subscriberCounts },
    checklist,
  }
}
