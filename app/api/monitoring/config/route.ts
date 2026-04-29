import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeMonitorConfig } from '@/lib/monitoring/config'
import { validateMonitorUrlWithDns } from '@/lib/monitoring/ssrf'
import { MONITOR_LIMITS, type MonitorConfigInput } from '@/lib/monitoring/types'
import type { MonitorCheckResult } from '@/lib/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = new URL(request.url).searchParams
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'Project ID is required.' }, { status: 400 })


  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const [configsRes, componentsRes] = await Promise.all([
    supabase.from('component_monitor_configs').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
    supabase.from('components').select('id').eq('project_id', projectId),
  ])

  if (configsRes.error) return NextResponse.json({ error: configsRes.error.message }, { status: 500 })
  if (componentsRes.error) return NextResponse.json({ error: componentsRes.error.message }, { status: 500 })

  const componentIds = (componentsRes.data ?? []).map((component) => component.id)

  const resultWindow = await fetchRecentResultsPerComponent(supabase, componentIds, projectId)
  if (resultWindow.error) return NextResponse.json({ error: resultWindow.error }, { status: 500 })

  return NextResponse.json({
    configs: configsRes.data ?? [],
    results: resultWindow.results,
    resultsCount: resultWindow.results.length,
  })
}

async function fetchRecentResultsPerComponent(supabase: SupabaseServerClient, componentIds: string[], projectId: string): Promise<{ results: MonitorCheckResult[]; error: string | null }> {
  if (componentIds.length === 0) return { results: [], error: null }

  const responses = await Promise.all(componentIds.map((componentId) => (
    supabase
      .from('monitor_check_results')
      .select('*')
      .eq('project_id', projectId)
      .eq('component_id', componentId)
      .order('checked_at', { ascending: false })
      .limit(MONITOR_LIMITS.MAX_RECENT_RESULTS)
  )))

  const error = responses.find((response) => response.error)?.error
  if (error) return { results: [], error: error.message }

  const results = responses
    .flatMap((response) => (response.data ?? []) as MonitorCheckResult[])
    .sort((first, second) => new Date(second.checked_at).getTime() - new Date(first.checked_at).getTime())

  return { results, error: null }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!isMonitorConfigBody(body)) {
    return NextResponse.json({
      error: 'Invalid monitor config.',
      details: 'Expected project_id, component_id and mode manual|automatic.',
    }, { status: 400 })
  }

  const { data: profile } = await supabase.from('profiles').select('plan').eq('id', user.id).single()
  const plan = profile?.plan ?? 'free'
  if (body.mode === 'automatic' && plan === 'free') {
    return NextResponse.json({ error: 'Automatic monitoring requires Pro or Business.' }, { status: 403 })
  }

  const { data: component } = await supabase
    .from('components')
    .select('id, project_id, projects!inner(user_id)')
    .eq('id', body.component_id)
    .eq('project_id', body.project_id)
    .single()

  if (!component) return NextResponse.json({ error: 'Component not found.' }, { status: 404 })

  const normalized = normalizeMonitorConfig(body, plan)
  if (normalized.mode === 'automatic') {
    if (!normalized.url) {
      return NextResponse.json({ error: 'URL is required for automatic monitoring.' }, { status: 400 })
    }
    const urlCheck = await validateMonitorUrlWithDns(normalized.url)
    if (!urlCheck.ok) {
      return NextResponse.json({
        error: urlCheck.reason,
        details: 'Monitoring targets must be public HTTPS URLs. Localhost, private networks and unresolved hosts are blocked to prevent SSRF.',
      }, { status: 400 })
    }
    normalized.url = urlCheck.normalizedUrl
  }

  const { data, error } = await supabase
    .from('component_monitor_configs')
    .upsert({ ...normalized, project_id: body.project_id }, { onConflict: 'component_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ config: data })
}

function isMonitorConfigBody(value: unknown): value is MonitorConfigInput & { project_id: string } {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.project_id === 'string' &&
    typeof body.component_id === 'string' &&
    (body.mode === 'manual' || body.mode === 'automatic')
  )
}
