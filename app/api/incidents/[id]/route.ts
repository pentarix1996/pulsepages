import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALERT_EVENT_TYPE, ALERT_SOURCE_TYPE, createIncidentDedupeKey, enqueueAlertEvent } from '@/lib/alerts/enqueue'
import type { AlertPayload } from '@/lib/alerts/types'
import type { ComponentStatus, IncidentSeverity, IncidentStatus, IncidentUpdate } from '@/lib/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface ProjectRow {
  id: string
  name: string
  slug: string
  profiles?: { username?: string | null } | null
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

interface ComponentRow {
  id: string
  project_id: string
  status: ComponentStatus
}

interface UpdateIncidentBody {
  updates: IncidentPatch
  message?: string
}

interface IncidentPatch {
  title?: string
  description?: string | null
  status?: IncidentStatus
  severity?: IncidentSeverity
  component_ids?: string[]
}

interface ComponentUpdateResult {
  id: string
  status: ComponentStatus
}

export async function PATCH(request: Request, context: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!isUpdateIncidentBody(body)) return NextResponse.json({ error: 'Invalid incident update payload.' }, { status: 400 })

  const { id: incidentId } = await context.params
  const { data: existingIncident } = await supabase
    .from('incidents')
    .select('id,project_id,title,description,status,severity,component_ids,duration,created_at')
    .eq('id', incidentId)
    .single()
  if (!isIncidentRow(existingIncident)) return NextResponse.json({ error: 'Incident not found.' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('id,name,slug,profiles(username)')
    .eq('id', existingIncident.project_id)
    .eq('user_id', user.id)
    .single()
  if (!isProjectRow(project)) return NextResponse.json({ error: 'Incident not found.' }, { status: 404 })

  if (body.updates.component_ids) {
    const components = await loadOwnedComponents(supabase, project.id, body.updates.component_ids)
    if (components === null) return NextResponse.json({ error: 'One or more components were not found.' }, { status: 404 })
  }

  const { data: updatedIncident, error: updateError } = await supabase
    .from('incidents')
    .update(body.updates)
    .eq('id', incidentId)
    .eq('project_id', project.id)
    .select('id,project_id,title,description,status,severity,component_ids,duration,created_at')
    .single()
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!isIncidentRow(updatedIncident)) return NextResponse.json({ error: 'Incident update failed.' }, { status: 500 })

  let incidentUpdate: IncidentUpdate | null = null
  if (body.message && body.updates.status) {
    const { data: updateData } = await supabase
      .from('incident_updates')
      .insert({ incident_id: incidentId, message: body.message, status: body.updates.status })
      .select('id,incident_id,message,status,created_at')
      .single()
    incidentUpdate = isIncidentUpdateRow(updateData) ? updateData : null
  }

  const componentUpdates = updatedIncident.status === 'resolved'
    ? await restoreComponentsForResolvedIncident(supabase, updatedIncident)
    : []
  const alertType = updatedIncident.status === 'resolved' ? ALERT_EVENT_TYPE.INCIDENT_RESOLVED : ALERT_EVENT_TYPE.INCIDENT_UPDATED
  const alert = await enqueueIncidentEventBestEffort(project, updatedIncident, alertType, body.message ?? 'Incident updated.')

  return NextResponse.json({ incident: updatedIncident, incident_update: incidentUpdate, component_updates: componentUpdates, alert })
}

async function loadOwnedComponents(supabase: SupabaseRouteClient, projectId: string, componentIds: string[]): Promise<ComponentRow[] | null> {
  if (componentIds.length === 0) return []
  const { data } = await supabase
    .from('components')
    .select('id,project_id,status')
    .eq('project_id', projectId)
    .in('id', componentIds)
  if (!Array.isArray(data)) return null
  const components = data.filter(isComponentRow)
  return components.length === componentIds.length ? components : null
}

async function restoreComponentsForResolvedIncident(supabase: SupabaseRouteClient, incident: IncidentRow): Promise<ComponentUpdateResult[]> {
  if (incident.component_ids.length === 0) return []
  const [{ data: projectIncidents }, { data: components }] = await Promise.all([
    supabase
      .from('incidents')
      .select('id,project_id,title,description,status,severity,component_ids')
      .eq('project_id', incident.project_id),
    supabase
      .from('components')
      .select('id,project_id,status')
      .eq('project_id', incident.project_id)
      .in('id', incident.component_ids),
  ])
  const incidents = Array.isArray(projectIncidents) ? projectIncidents.filter(isIncidentRow) : []
  const componentRows = Array.isArray(components) ? components.filter(isComponentRow) : []
  const updates: ComponentUpdateResult[] = []

  for (const component of componentRows) {
    const nextStatus = getHighestSeverityStatus(incidents, component.id) ?? 'operational'
    if (nextStatus === component.status) continue
    const { error: updateError } = await supabase
      .from('components')
      .update({ status: nextStatus })
      .eq('id', component.id)
      .eq('project_id', incident.project_id)
    if (updateError) continue
    await supabase
      .from('component_status_history')
      .insert({ component_id: component.id, status: nextStatus, reason: 'incident_resolved', incident_id: incident.id })
    updates.push({ id: component.id, status: nextStatus })
  }

  return updates
}

async function enqueueIncidentEventBestEffort(project: ProjectRow, incident: IncidentRow, type: typeof ALERT_EVENT_TYPE.INCIDENT_UPDATED | typeof ALERT_EVENT_TYPE.INCIDENT_RESOLVED, reason: string) {
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
  if (!result.queued) console.warn('[alerts] incident alert enqueue failed after incident update', result.error)
  return { queued: result.queued, warning: result.queued ? null : result.error ?? 'Incident updated but alert enqueue failed.' }
}

type SupabaseRouteClient = Awaited<ReturnType<typeof createClient>>

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const SEVERITY_TO_STATUS: Record<IncidentSeverity, ComponentStatus> = {
  critical: 'major_outage',
  high: 'partial_outage',
  medium: 'degraded',
  low: 'degraded',
}

function getHighestSeverityStatus(incidents: IncidentRow[], componentId: string): ComponentStatus | null {
  let worstSeverity: IncidentSeverity | null = null
  for (const incident of incidents) {
    if (incident.status === 'resolved' || incident.status === 'maintenance') continue
    if (!incident.component_ids.includes(componentId)) continue
    worstSeverity = worstSeverity === null || SEVERITY_RANK[incident.severity] > SEVERITY_RANK[worstSeverity] ? incident.severity : worstSeverity
  }
  return worstSeverity ? SEVERITY_TO_STATUS[worstSeverity] : null
}

function createStatusPageUrl(project: ProjectRow): string | null {
  const username = project.profiles?.username
  return username ? `/status/${username}/${project.slug}` : null
}

function isUpdateIncidentBody(value: unknown): value is UpdateIncidentBody {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return isIncidentPatch(data.updates) && optionalString(data.message)
}

function isIncidentPatch(value: unknown): value is IncidentPatch {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  const allowedKeys = ['title', 'description', 'status', 'severity', 'component_ids']
  if (Object.keys(data).some((key) => !allowedKeys.includes(key))) return false
  return optionalString(data.title)
    && (data.description === undefined || typeof data.description === 'string' || data.description === null)
    && (data.status === undefined || isIncidentStatus(data.status))
    && (data.severity === undefined || isIncidentSeverity(data.severity))
    && (data.component_ids === undefined || (Array.isArray(data.component_ids) && data.component_ids.every((id) => typeof id === 'string')))
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isProjectRow(value: unknown): value is ProjectRow {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string' && typeof data.name === 'string' && typeof data.slug === 'string'
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

function isComponentRow(value: unknown): value is ComponentRow {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.id === 'string' && typeof data.project_id === 'string' && isComponentStatus(data.status)
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
