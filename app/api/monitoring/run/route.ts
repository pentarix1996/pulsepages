import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isComponentStatus, normalizeMonitorConfig } from '@/lib/monitoring/config'
import { executeMonitorCheck } from '@/lib/monitoring/fetch'
import type { NormalizedMonitorConfig } from '@/lib/monitoring/types'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  if (typeof body !== 'object' || body === null || typeof body.config_id !== 'string') {
    return NextResponse.json({ error: 'Invalid config ID.' }, { status: 400 })
  }

  const { data: profile } = await supabase.from('profiles').select('plan').eq('id', user.id).single()
  if (!profile || profile.plan === 'free') return NextResponse.json({ error: 'Automatic monitoring requires Pro or Business.' }, { status: 403 })

  const { data: config } = await supabase
    .from('component_monitor_configs')
    .select('*, components!inner(id, status, project_id, projects!inner(user_id))')
    .eq('id', body.config_id)
    .single()

  if (!config || config.components?.projects?.user_id !== user.id) {
    return NextResponse.json({ error: 'Monitor config not found.' }, { status: 404 })
  }
  if (config.mode !== 'automatic') return NextResponse.json({ error: 'Component is in manual mode.' }, { status: 400 })
  if (hasInvalidMonitorStatuses(config)) return NextResponse.json({ error: 'Monitor config contains invalid component statuses.' }, { status: 400 })

  const normalized = normalizeMonitorConfig(config, profile.plan) as NormalizedMonitorConfig
  const result = await executeMonitorCheck(normalized)
  const now = new Date().toISOString()

  if (!isComponentStatus(result.resultingStatus)) {
    await supabase.from('component_monitor_configs').update({ last_checked_at: now, next_check_at: new Date(Date.now() + normalized.interval_seconds * 1000).toISOString() }).eq('id', config.id)
    return NextResponse.json({ error: 'Monitor produced an invalid component status.' }, { status: 422 })
  }

  const { data: checkResult, error: resultError } = await supabase
    .from('monitor_check_results')
    .insert({
      config_id: config.id,
      project_id: config.project_id,
      component_id: config.component_id,
      status: result.checkStatus,
      resulting_status: result.resultingStatus,
      http_status: result.httpStatus,
      response_time_ms: result.responseTimeMs,
      error_message: result.errorMessage,
      checked_at: now,
    })
    .select()
    .single()

  if (resultError) return NextResponse.json({ error: resultError.message }, { status: 500 })

  await supabase.from('component_monitor_configs').update({ last_checked_at: now, next_check_at: new Date(Date.now() + normalized.interval_seconds * 1000).toISOString() }).eq('id', config.id)

  if (config.components.status !== result.resultingStatus) {
    const hasActiveIncident = await componentHasActiveIncident(supabase, config.project_id, config.component_id)
    if (!hasActiveIncident || result.resultingStatus !== 'operational') {
      await supabase.from('components').update({ status: result.resultingStatus }).eq('id', config.component_id)
      await supabase.from('component_status_history').insert({ component_id: config.component_id, status: result.resultingStatus, reason: result.resultingStatus === 'operational' ? 'monitor_recovery' : 'monitor' })
    }
  }

  return NextResponse.json({ result: checkResult })
}

function hasInvalidMonitorStatuses(config: Record<string, unknown>): boolean {
  if (!isComponentStatus(config.failure_status)) return true
  if (!isComponentStatus(config.no_match_status)) return true
  if (!Array.isArray(config.json_rules)) return false

  return config.json_rules.some((rule) => {
    if (typeof rule !== 'object' || rule === null || !('targetStatus' in rule)) return false
    return !isComponentStatus(rule.targetStatus)
  })
}

async function componentHasActiveIncident(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  componentId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('incidents')
    .select('id')
    .eq('project_id', projectId)
    .neq('status', 'resolved')
    .contains('component_ids', [componentId])
    .limit(1)

  return Boolean(data && data.length > 0)
}
