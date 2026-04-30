import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALERT_SOURCE_TYPE, enqueueComponentTransitionAlert } from '@/lib/alerts/enqueue'
import type { ComponentStatus } from '@/lib/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

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

export async function PATCH(request: Request, context: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!isStatusUpdateBody(body)) return NextResponse.json({ error: 'Invalid component status payload.' }, { status: 400 })

  const { id: componentId } = await context.params
  const { data: project } = await supabase
    .from('projects')
    .select('id,name,slug,profiles(username)')
    .eq('id', body.project_id)
    .eq('user_id', user.id)
    .single()
  if (!isProjectRow(project)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const { data: existingComponent } = await supabase
    .from('components')
    .select('id,project_id,name,status')
    .eq('id', componentId)
    .eq('project_id', project.id)
    .single()
  if (!isComponentRow(existingComponent)) return NextResponse.json({ error: 'Component not found.' }, { status: 404 })

  const previousStatus = existingComponent.status
  const { data: updatedComponent, error: updateError } = await supabase
    .from('components')
    .update({ status: body.status })
    .eq('id', componentId)
    .eq('project_id', project.id)
    .select('id,project_id,name,status')
    .single()
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!isComponentRow(updatedComponent)) return NextResponse.json({ error: 'Component update failed.' }, { status: 500 })

  if (previousStatus !== body.status) {
    const { error: historyError } = await supabase
      .from('component_status_history')
      .insert({ component_id: componentId, status: body.status, reason: 'manual', incident_id: null })
    if (historyError) return NextResponse.json({ error: historyError.message }, { status: 500 })
  }

  const alertResult = await enqueueComponentTransitionAlert({
    projectId: project.id,
    projectName: project.name,
    componentId: updatedComponent.id,
    componentName: updatedComponent.name,
    previousStatus,
    currentStatus: updatedComponent.status,
    sourceType: ALERT_SOURCE_TYPE.MANUAL,
    sourceId: updatedComponent.id,
    reason: `${updatedComponent.name} changed from ${previousStatus} to ${updatedComponent.status}.`,
    monitor: null,
    dashboardUrl: `/project/${project.id}`,
    statusPageUrl: createStatusPageUrl(project),
  })

  if (!alertResult.queued && !alertResult.skipped) {
    console.warn('[alerts] component status alert enqueue failed after status update', alertResult.error)
  }

  return NextResponse.json({
    component: updatedComponent,
    alert: {
      queued: alertResult.queued,
      skipped: alertResult.skipped,
      warning: alertResult.queued || alertResult.skipped ? null : alertResult.error ?? 'Component status updated but alert enqueue failed.',
    },
  })
}

interface StatusUpdateBody {
  project_id: string
  status: ComponentStatus
}

function isStatusUpdateBody(value: unknown): value is StatusUpdateBody {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.project_id === 'string' && isComponentStatus(data.status)
}

function isComponentStatus(value: unknown): value is ComponentStatus {
  return value === 'operational' || value === 'degraded' || value === 'partial_outage' || value === 'major_outage' || value === 'maintenance'
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

function createStatusPageUrl(project: ProjectRow): string | null {
  const username = project.profiles?.username
  return username ? `/status/${username}/${project.slug}` : null
}
