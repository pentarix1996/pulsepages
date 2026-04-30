import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALERT_CHANNEL_TYPE } from '@/lib/alerts/types'
import { ALERT_LIMITS, DEFAULT_EMAIL_CHANNEL_CONFIG, DEFAULT_PROJECT_ALERT_CONFIG, normalizeEmailChannelConfig, normalizeProjectAlertConfig } from '@/lib/alerts/config'
import { ALERT_CHANNEL_METADATA } from '@/lib/alerts/channels'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'Project ID is required.' }, { status: 400 })
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const [projectConfigRes, channelConfigRes, deliveriesRes] = await Promise.all([
    supabase.from('project_alert_configs').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('alert_channel_configs').select('*').eq('project_id', projectId).eq('type', ALERT_CHANNEL_TYPE.EMAIL).maybeSingle(),
    supabase
      .from('alert_deliveries')
      .select('*, alert_events!inner(project_id,type,created_at,payload)')
      .eq('alert_events.project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(ALERT_LIMITS.RECENT_DELIVERIES_LIMIT),
  ])

  if (projectConfigRes.error) return NextResponse.json({ error: projectConfigRes.error.message }, { status: 500 })
  if (channelConfigRes.error) return NextResponse.json({ error: channelConfigRes.error.message }, { status: 500 })
  if (deliveriesRes.error) return NextResponse.json({ error: deliveriesRes.error.message }, { status: 500 })

  return NextResponse.json({
    projectConfig: projectConfigRes.data ? normalizeProjectAlertConfig(projectConfigRes.data) : DEFAULT_PROJECT_ALERT_CONFIG,
    emailChannel: channelConfigRes.data ? { enabled: channelConfigRes.data.enabled === true, config: normalizeEmailChannelConfig(channelConfigRes.data.config) } : { enabled: false, config: DEFAULT_EMAIL_CHANNEL_CONFIG },
    channels: ALERT_CHANNEL_METADATA,
    deliveries: deliveriesRes.data ?? [],
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!isPatchBody(body)) return NextResponse.json({ error: 'Invalid alerts config payload.' }, { status: 400 })

  const { data: project } = await supabase.from('projects').select('id').eq('id', body.project_id).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  let projectConfig: ReturnType<typeof normalizeProjectAlertConfig> | null = null
  let emailConfig: ReturnType<typeof normalizeEmailChannelConfig> | null = null
  try {
    if (body.projectConfig !== undefined) projectConfig = normalizeProjectAlertConfig(body.projectConfig)
    if (body.emailChannel !== undefined) emailConfig = normalizeEmailChannelConfig(body.emailChannel.config)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid alerts config.' }, { status: 400 })
  }

  const [projectRes, channelRes] = await Promise.all([
    projectConfig ? supabase.from('project_alert_configs').upsert({ project_id: body.project_id, ...projectConfig }, { onConflict: 'project_id' }).select().single() : Promise.resolve({ data: null, error: null }),
    body.emailChannel && emailConfig ? supabase.from('alert_channel_configs').upsert({ project_id: body.project_id, type: ALERT_CHANNEL_TYPE.EMAIL, enabled: body.emailChannel.enabled === true, config: emailConfig }, { onConflict: 'project_id,type' }).select().single() : Promise.resolve({ data: null, error: null }),
  ])

  if (projectRes.error) return NextResponse.json({ error: projectRes.error.message }, { status: 500 })
  if (channelRes.error) return NextResponse.json({ error: channelRes.error.message }, { status: 500 })
  return NextResponse.json({ projectConfig: projectRes.data, emailChannel: channelRes.data })
}

interface PatchBody {
  project_id: string
  projectConfig?: unknown
  emailChannel?: { enabled: boolean; config: unknown }
}

function isPatchBody(value: unknown): value is PatchBody {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  const emailChannel = data.emailChannel
  const hasProjectConfig = 'projectConfig' in data
  const hasEmailChannel = typeof emailChannel === 'object' && emailChannel !== null && 'config' in emailChannel
  return typeof data.project_id === 'string' && (hasProjectConfig || hasEmailChannel)
}
