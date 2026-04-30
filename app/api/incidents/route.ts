import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALERT_EVENT_TYPE, ALERT_SOURCE_TYPE, createIncidentDedupeKey, enqueueAlertEvent } from '@/lib/alerts/enqueue'
import type { AlertPayload } from '@/lib/alerts/types'
import type { ComponentStatus, IncidentSeverity, IncidentStatus, IncidentUpdate } from '@/lib/types'

interface ProjectRow {
  id: string
  name: string
  slug: string
  profiles?: { username?: string | null } | null
}

interface ComponentRow {
  id: string
  project_id: string
  name: string
  status: ComponentStatus
}

interface IncidentRow {
  id: string
  project_id: string
  title: string
  description: string | null
  status: IncidentStatus
  severity: IncidentSeverity
  component_ids: string[]
  duration?: number
  created_at?: string
}

interface CreateIncidentBody {
  project_id: string
  title: string
  description: string
  status: IncidentStatus
  severity: IncidentSeverity
  component_ids: string[]
}

interface ComponentUpdateResult {
  id: string
  status: ComponentStatus
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!isCreateIncidentBody(body)) return NextResponse.json({ error: 'Invalid incident payload.' }, { status: 400 })

  const { data: project } = await supabase
    .from('projects')
    .select('id,name,slug,profiles(username)')
    .eq('id', body.project_id)
    .eq('user_id', user.id)
    .single()
  if (!isProjectRow(project)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const componentRows = await loadOwnedComponents(supabase, project.id, body.component_ids)
  if (componentRows === null) return NextResponse.json({ error: 'One or more components were not found.' }, { status: 404 })

  const { data: incidentData, error: incidentError } = await supabase
    .from('incidents')
    .insert({
      project_id: project.id,
      title: body.title,
      description: body.description,
      status: body.status,
      severity: body.severity,
      component_ids: body.component_ids,
    })
    .select('id,project_id,title,description,status,severity,component_ids,duration,created_at')
    .single()
  if (incidentError) return NextResponse.json({ error: incidentError.message }, { status: 500 })
  if (!isIncidentRow(incidentData)) return NextResponse.json({ error: 'Incident creation failed.' }, { status: 500 })

  const updateMessage = incidentData.description || 'Incident reported.'
  const { data: updateData } = await supabase
    .from('incident_updates')
    .insert({ incident_id: incidentData.id, message: updateMessage, status: incidentData.status })
    .select('id,incident_id,message,status,created_at')
    .single()

  const componentUpdates = await applyIncidentComponentImpact(supabase, incidentData, componentRows)
  const alert = await enqueueIncidentEventBestEffort(project, incidentData, ALERT_EVENT_TYPE.INCIDENT_CREATED, 'Incident reported.')

  return NextResponse.json({
    incident: {
      ...incidentData,
      incident_updates: isIncidentUpdateRow(updateData) ? [updateData] : [],
    },
    component_updates: componentUpdates,
    alert,
  })
}

async function loadOwnedComponents(supabase: SupabaseRouteClient, projectId: string, componentIds: string[]): Promise<ComponentRow[] | null> {
  if (componentIds.length === 0) return []
  const { data } = await supabase
    .from('components')
    .select('id,project_id,name,status')
    .eq('project_id', projectId)
    .in('id', componentIds)
  if (!Array.isArray(data)) return null
  const components = data.filter(isComponentRow)
  return components.length === componentIds.length ? components : null
}

async function applyIncidentComponentImpact(supabase: SupabaseRouteClient, incident: IncidentRow, components: ComponentRow[]): Promise<ComponentUpdateResult[]> {
  if (incident.status === 'resolved' || incident.status === 'maintenance' || incident.severity === 'low') return []

  const targetStatus = getComponentStatusFromSeverity(incident.severity)
  const updates: ComponentUpdateResult[] = []
  for (const component of components) {
    const nextStatus = getWorseStatus(component.status, targetStatus)
    if (nextStatus === component.status) continue

    const { error: updateError } = await supabase
      .from('components')
      .update({ status: nextStatus })
      .eq('id', component.id)
      .eq('project_id', incident.project_id)
    if (updateError) continue

    await supabase
      .from('component_status_history')
      .insert({ component_id: component.id, status: nextStatus, reason: 'incident', incident_id: incident.id })
    updates.push({ id: component.id, status: nextStatus })
  }
  return updates
}

async function enqueueIncidentEventBestEffort(project: ProjectRow, incident: IncidentRow, type: typeof ALERT_EVENT_TYPE.INCIDENT_CREATED, reason: string) {
  const payload: AlertPayload = {
    project_id: project.id,
    project_name: project.name,
    event_type: type,
    status: incident.status,
    severity: incident.severity,
    reason,
    occurred_at: new Date().toISOString(),
    dashboard_url: `/project/${project.id}`,
    status_page_url: createStatusPageUrl(project),
    component: null,
    incident: {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      severity: incident.severity,
      url: `/project/${project.id}`,
    },
    monitor: null,
  }
  const result = await enqueueAlertEvent({
    projectId: project.id,
    type,
    sourceType: ALERT_SOURCE_TYPE.INCIDENT,
    sourceId: incident.id,
    severity: incident.severity,
    dedupeKey: createIncidentDedupeKey(project.id, type, incident.id, incident.status),
    payload,
  })
  if (!result.queued) console.warn('[alerts] incident alert enqueue failed after incident create', result.error)
  return { queued: result.queued, warning: result.queued ? null : result.error ?? 'Incident created but alert enqueue failed.' }
}

type SupabaseRouteClient = Awaited<ReturnType<typeof createClient>>

const STATUS_RANK: Record<ComponentStatus, number> = {
  operational: 1,
  maintenance: 2,
  degraded: 3,
  partial_outage: 4,
  major_outage: 5,
}

const SEVERITY_TO_STATUS: Record<IncidentSeverity, ComponentStatus> = {
  critical: 'major_outage',
  high: 'partial_outage',
  medium: 'degraded',
  low: 'degraded',
}

function getComponentStatusFromSeverity(severity: IncidentSeverity): ComponentStatus {
  return SEVERITY_TO_STATUS[severity]
}

function getWorseStatus(current: ComponentStatus, target: ComponentStatus): ComponentStatus {
  return STATUS_RANK[current] >= STATUS_RANK[target] ? current : target
}

function createStatusPageUrl(project: ProjectRow): string | null {
  const username = project.profiles?.username
  return username ? `/status/${username}/${project.slug}` : null
}

function isCreateIncidentBody(value: unknown): value is CreateIncidentBody {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.project_id === 'string'
    && typeof data.title === 'string'
    && typeof data.description === 'string'
    && isIncidentStatus(data.status)
    && isIncidentSeverity(data.severity)
    && Array.isArray(data.component_ids)
    && data.component_ids.every((id) => typeof id === 'string')
}

function isProjectRow(value: unknown): value is ProjectRow {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string' && typeof data.name === 'string' && typeof data.slug === 'string'
}

function isComponentRow(value: unknown): value is ComponentRow {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string' && typeof data.project_id === 'string' && typeof data.name === 'string' && isComponentStatus(data.status)
}

function isIncidentRow(value: unknown): value is IncidentRow {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string'
    && typeof data.project_id === 'string'
    && typeof data.title === 'string'
    && (typeof data.description === 'string' || data.description === null)
    && isIncidentStatus(data.status)
    && isIncidentSeverity(data.severity)
    && Array.isArray(data.component_ids)
    && data.component_ids.every((id) => typeof id === 'string')
}

function isIncidentUpdateRow(value: unknown): value is IncidentUpdate {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string' && typeof data.incident_id === 'string' && typeof data.message === 'string' && typeof data.status === 'string' && typeof data.created_at === 'string'
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
