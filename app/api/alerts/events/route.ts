import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALERT_EVENT_TYPE, ALERT_SOURCE_TYPE, createIncidentDedupeKey, enqueueAlertEvent, enqueueComponentTransitionAlert } from '@/lib/alerts/enqueue'
import type { AlertEventType, AlertPayload } from '@/lib/alerts/types'
import type { ComponentStatus, IncidentSeverity, IncidentStatus } from '@/lib/types'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!isEventIntentBody(body)) return NextResponse.json({ error: 'Invalid alert event payload.' }, { status: 400 })

  const { data: project } = await supabase.from('projects').select('id').eq('id', body.project_id).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const alertsSupabase = supabase as unknown as SupabaseLike
  const result = body.intent === 'component_transition'
    ? await enqueueManualComponentTransition(alertsSupabase, body)
    : await enqueueManualIncidentEvent(alertsSupabase, body)

  if (!result.queued) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ queued: true, skipped: 'skipped' in result ? result.skipped : false })
}

interface ComponentTransitionIntentBody {
  intent: 'component_transition'
  project_id: string
  component_id: string
  previous_status: ComponentStatus
  reason?: string
}

interface IncidentEventIntentBody {
  intent: 'incident_event'
  project_id: string
  incident_id: string
  type: typeof ALERT_EVENT_TYPE.INCIDENT_CREATED | typeof ALERT_EVENT_TYPE.INCIDENT_UPDATED | typeof ALERT_EVENT_TYPE.INCIDENT_RESOLVED
  reason?: string
}

type EventIntentBody = ComponentTransitionIntentBody | IncidentEventIntentBody

interface ProjectRow {
  id: string
  name: string
  slug: string
  profiles?: { username?: string | null } | null
}

interface ComponentRow {
  id: string
  name: string
  status: ComponentStatus
}

interface IncidentRow {
  id: string
  title: string
  status: IncidentStatus
  severity: IncidentSeverity
}

interface SupabaseLike {
  from(table: string): SupabaseSelectLike
}

interface SupabaseSelectLike {
  select(columns?: string): SupabaseQueryLike
}

interface SupabaseQueryLike {
  eq(column: string, value: unknown): SupabaseQueryLike
  single(): PromiseLike<{ data: unknown; error?: { message: string } | null }>
}

async function enqueueManualComponentTransition(supabase: SupabaseLike, body: ComponentTransitionIntentBody) {
  const [projectRes, componentRes] = await Promise.all([
    supabase.from('projects').select('id,name,slug,profiles(username)').eq('id', body.project_id).single(),
    supabase.from('components').select('id,name,status').eq('id', body.component_id).eq('project_id', body.project_id).single(),
  ])
  if (!isProjectRow(projectRes.data)) return { queued: false, skipped: false, error: 'Project not found.' }
  if (!isComponentRow(componentRes.data)) return { queued: false, skipped: false, error: 'Component not found.' }

  return enqueueComponentTransitionAlert({
    projectId: projectRes.data.id,
    projectName: projectRes.data.name,
    componentId: componentRes.data.id,
    componentName: componentRes.data.name,
    previousStatus: body.previous_status,
    currentStatus: componentRes.data.status,
    sourceType: ALERT_SOURCE_TYPE.MANUAL,
    sourceId: componentRes.data.id,
    reason: body.reason ?? `${componentRes.data.name} changed from ${body.previous_status} to ${componentRes.data.status}.`,
    monitor: null,
    dashboardUrl: `/project/${projectRes.data.id}`,
    statusPageUrl: createStatusPageUrl(projectRes.data),
  })
}

async function enqueueManualIncidentEvent(supabase: SupabaseLike, body: IncidentEventIntentBody): Promise<{ queued: boolean; error: string | null }> {
  const [projectRes, incidentRes] = await Promise.all([
    supabase.from('projects').select('id,name,slug,profiles(username)').eq('id', body.project_id).single(),
    supabase.from('incidents').select('id,title,status,severity').eq('id', body.incident_id).eq('project_id', body.project_id).single(),
  ])
  if (!isProjectRow(projectRes.data)) return { queued: false, error: 'Project not found.' }
  if (!isIncidentRow(incidentRes.data)) return { queued: false, error: 'Incident not found.' }

  const payload: AlertPayload = {
    project_id: projectRes.data.id,
    project_name: projectRes.data.name,
    event_type: body.type as AlertEventType,
    status: incidentRes.data.status,
    severity: incidentRes.data.severity,
    reason: body.reason ?? 'Incident updated.',
    occurred_at: new Date().toISOString(),
    dashboard_url: `/project/${projectRes.data.id}`,
    status_page_url: createStatusPageUrl(projectRes.data),
    component: null,
    incident: {
      id: incidentRes.data.id,
      title: incidentRes.data.title,
      status: incidentRes.data.status,
      severity: incidentRes.data.severity,
      url: `/project/${projectRes.data.id}`,
    },
    monitor: null,
  }

  return enqueueAlertEvent({
    projectId: projectRes.data.id,
    type: body.type,
    sourceType: ALERT_SOURCE_TYPE.INCIDENT,
    sourceId: incidentRes.data.id,
    severity: incidentRes.data.severity,
    dedupeKey: createIncidentDedupeKey(projectRes.data.id, body.type, incidentRes.data.id, incidentRes.data.status),
    payload,
  })
}

function isEventIntentBody(value: unknown): value is EventIntentBody {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  if (data.intent === 'component_transition') {
    return typeof data.project_id === 'string' && typeof data.component_id === 'string' && isComponentStatus(data.previous_status) && optionalString(data.reason)
  }
  if (data.intent === 'incident_event') {
    return typeof data.project_id === 'string' && typeof data.incident_id === 'string' && isAllowedIncidentType(data.type) && optionalString(data.reason)
  }
  return false
}

function isAllowedIncidentType(value: unknown): value is IncidentEventIntentBody['type'] {
  return value === ALERT_EVENT_TYPE.INCIDENT_CREATED || value === ALERT_EVENT_TYPE.INCIDENT_UPDATED || value === ALERT_EVENT_TYPE.INCIDENT_RESOLVED
}

function isComponentStatus(value: unknown): value is ComponentStatus {
  return value === 'operational' || value === 'degraded' || value === 'partial_outage' || value === 'major_outage' || value === 'maintenance'
}

function isIncidentStatus(value: unknown): value is IncidentStatus {
  return value === 'investigating' || value === 'identified' || value === 'monitoring' || value === 'resolved' || value === 'maintenance'
}

function isIncidentSeverity(value: unknown): value is IncidentSeverity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function createStatusPageUrl(project: ProjectRow): string | null {
  const username = project.profiles?.username
  return username ? `/status/${username}/${project.slug}` : null
}

function isProjectRow(value: unknown): value is ProjectRow {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string' && typeof data.name === 'string' && typeof data.slug === 'string'
}

function isComponentRow(value: unknown): value is ComponentRow {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string' && typeof data.name === 'string' && isComponentStatus(data.status)
}

function isIncidentRow(value: unknown): value is IncidentRow {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string' && typeof data.title === 'string' && isIncidentStatus(data.status) && isIncidentSeverity(data.severity)
}
