import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALERT_EVENT_TYPE, ALERT_SOURCE_TYPE, enqueueAlertEvent } from '@/lib/alerts/enqueue'
import type { AlertPayload } from '@/lib/alerts/types'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (typeof body !== 'object' || body === null || typeof body.project_id !== 'string') {
    return NextResponse.json({ error: 'Project ID is required.' }, { status: 400 })
  }

  const { data: project } = await supabase.from('projects').select('id,name,slug,profiles(username)').eq('id', body.project_id).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const payload: AlertPayload = {
    project_id: project.id,
    project_name: project.name,
    event_type: ALERT_EVENT_TYPE.TEST,
    status: 'operational',
    severity: 'test',
    reason: 'This is a test alert from Upvane. If you received it, email alerts are configured correctly.',
    occurred_at: new Date().toISOString(),
    dashboard_url: `${getBaseUrl(request)}/project/${project.id}/alerts`,
    status_page_url: null,
    component: null,
    incident: null,
    monitor: null,
  }
  const result = await enqueueAlertEvent({
    projectId: project.id,
    type: ALERT_EVENT_TYPE.TEST,
    sourceType: ALERT_SOURCE_TYPE.TEST,
    sourceId: null,
    severity: 'test',
    dedupeKey: `${project.id}:test:${Date.now()}`,
    payload,
  })
  if (!result.queued) return NextResponse.json({ error: result.error ?? 'Could not enqueue test alert.' }, { status: 500 })
  return NextResponse.json({ queued: true })
}

function getBaseUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
}
