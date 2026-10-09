// monitor-runner orchestration: claim monitors, probe every region in parallel, apply the confirmation state machine
// (_shared/monitoring/state.ts) and persist with record_monitor_run(). Dependencies are injected for tests.
import { errorMessage } from '../_shared/edge/log.ts'
import type { Logger } from '../_shared/edge/log.ts'
import type { AdminClient } from '../_shared/edge/supabase.ts'
import {
  buildProbeRequest,
  drainWithBudget,
  earliestTlsExpiry,
  errorProbeResult,
  parseRunPayload,
  RUN_NOW_CONFLICT_MESSAGE,
  selectProbeRegions,
} from '../_shared/monitoring/runner.ts'
import { evaluateRun } from '../_shared/monitoring/state.ts'
import type { ConfirmedState, MonitorRunPayload, ProbeRequest, ProbeResult } from '../_shared/monitoring/types.ts'

export interface RunnerDeps {
  db: AdminClient
  /** Runs the check in one region through monitor-probe. Never rejects: failures come back as `error` results. */
  probe(region: string, request: ProbeRequest): Promise<ProbeResult>
  /** MONITOR_PROBE_REGIONS, or null to probe every region of the monitor. */
  allowList: string[] | null
  now(): Date
  /** Monotonic milliseconds, for durations and the cron budget. */
  clock(): number
  log: Logger
}

export interface MonitorRun {
  monitorId: string
  previousState: string
  /** Null when every probe errored before the monitor had a confirmed state (the stored state is kept). */
  state: ConfirmedState | null
  results: ProbeResult[]
  persisted: boolean
  error: string | null
}

/** Probes one claimed monitor in all its regions, evaluates the run and records it. */
export async function runMonitor(payload: MonitorRunPayload, deps: RunnerDeps): Promise<MonitorRun> {
  const started = deps.clock()
  const { probe: regions, skipped } = selectProbeRegions(payload.regions, deps.allowList)
  const request = buildProbeRequest(payload)
  const probeMs: Record<string, number> = {}

  let evaluated: string[]
  let results: ProbeResult[]
  if (regions.length > 0) {
    evaluated = regions
    results = await Promise.all(
      regions.map(async (region) => {
        const regionStarted = deps.clock()
        const result = await deps.probe(region, request)
        probeMs[region] = Math.round(deps.clock() - regionStarted)
        return result
      }),
    )
  } else {
    // None of the monitor's regions can be probed here: say so instead of silently skipping the monitor.
    evaluated = [...new Set(payload.regions)]
    results = evaluated.map((region) =>
      errorProbeResult(region, `No probe runs in ${region} on this deployment. Add it to MONITOR_PROBE_REGIONS or pick another region.`, deps.now())
    )
  }

  const evaluation = evaluateRun({
    previousState: payload.state,
    regions: evaluated,
    previous: payload.region_states ?? {},
    results,
    settings: { confirm_failures: payload.confirm_failures, recovery_successes: payload.recovery_successes, confirm_regions: payload.confirm_regions },
  })

  let persisted = true
  let error: string | null = null
  try {
    await deps.db.rpc('record_monitor_run', {
      p_monitor_id: payload.id,
      p_results: results,
      p_region_states: evaluation.regionStates,
      p_state: evaluation.state,
      p_summary: skipped.length > 0 ? { ...evaluation.summary, skipped_regions: skipped } : evaluation.summary,
      p_last_error: evaluation.lastError,
      p_tls_expires_at: earliestTlsExpiry(results),
    })
  } catch (caught) {
    persisted = false
    error = errorMessage(caught)
  }

  deps.log(persisted ? 'info' : 'error', 'monitor_run', {
    monitor_id: payload.id,
    project_id: payload.project_id,
    type: payload.type,
    previous_state: payload.state,
    state: evaluation.state,
    regions: Object.fromEntries(results.map((result) => [result.region, result.status])),
    probe_ms: probeMs,
    duration_ms: Math.round(deps.clock() - started),
    persisted,
    ...(skipped.length > 0 ? { skipped_regions: skipped } : {}),
    ...(evaluation.lastError ? { last_error: evaluation.lastError } : {}),
    ...(error ? { error } : {}),
  })

  return { monitorId: payload.id, previousState: payload.state, state: evaluation.state, results, persisted, error }
}

export interface CronOptions {
  /** claim_due_monitors(p_limit). */
  batchSize: number
  /** Monitors probed at the same time. */
  concurrency: number
  /** Stop claiming after this long (cron runs every 30 s). */
  budgetMs: number
}

export const CRON_DEFAULTS: CronOptions = { batchSize: 25, concurrency: 8, budgetMs: 25_000 }

export interface CronSummary {
  source: 'cron'
  claimed: number
  processed: number
  persisted: number
  failed: number
  states: { up: number; degraded: number; down: number; unknown: number }
  budget_exhausted: boolean
  duration_ms: number
  error?: string
}

/** Cron mode: claims due monitors in batches and runs them with bounded concurrency until none is due or time is up. */
export async function runDueMonitors(deps: RunnerDeps, options: CronOptions = CRON_DEFAULTS): Promise<CronSummary> {
  const started = deps.clock()
  const states = { up: 0, degraded: 0, down: 0, unknown: 0 }
  let persisted = 0
  let failed = 0

  const stats = await drainWithBudget(
    async () => {
      const rows = await deps.db.rpc<unknown>('claim_due_monitors', { p_limit: options.batchSize })
      return Array.isArray(rows) ? rows : []
    },
    async (row: unknown) => {
      const payload = parseRunPayload(row)
      if (!payload) {
        failed += 1
        deps.log('error', 'monitor_payload_invalid', { monitor_id: typeof row === 'object' && row !== null ? (row as { id?: unknown }).id ?? null : null })
        return
      }
      const run = await runMonitor(payload, deps)
      if (run.persisted) persisted += 1
      else failed += 1
      states[run.state ?? 'unknown'] += 1
    },
    { concurrency: options.concurrency, budgetMs: options.budgetMs, now: () => deps.clock() },
  )

  const summary: CronSummary = {
    source: 'cron',
    claimed: stats.claimed,
    processed: stats.processed,
    persisted,
    failed,
    states,
    budget_exhausted: stats.budgetExhausted,
    duration_ms: Math.round(deps.clock() - started),
  }
  if (stats.claimError) {
    summary.error = 'Could not claim due monitors.'
    deps.log('error', 'monitor_claim_failed', { error: errorMessage(stats.claimError) })
  }
  deps.log(summary.error ? 'warn' : 'info', 'monitor_runner_summary', { ...summary })
  return summary
}

export interface RunNowOutcome {
  status: number
  body: unknown
}

/**
 * "Run now" from the dashboard: 200 `{ state, results }`, 409 when the monitor was claimed in the last 10 seconds,
 * 404 for unknown monitors and heartbeats.
 */
export async function runMonitorNow(monitorId: string, deps: RunnerDeps): Promise<RunNowOutcome> {
  let row: unknown
  try {
    row = await deps.db.rpc<unknown>('claim_monitor', { p_monitor_id: monitorId })
  } catch (error) {
    deps.log('error', 'monitor_claim_failed', { monitor_id: monitorId, error: errorMessage(error) })
    return { status: 500, body: { error: 'Could not start the check. Try again in a moment.', code: 'internal' } }
  }

  if (row === null || row === undefined) {
    // claim_monitor() returns null for unknown monitors, heartbeats and monitors claimed less than 10 seconds ago.
    let monitors: Array<{ id: string; type: string }>
    try {
      monitors = await deps.db.select<{ id: string; type: string }>('monitors', { select: 'id,type', id: `eq.${monitorId}`, limit: '1' })
    } catch (error) {
      deps.log('error', 'monitor_lookup_failed', { monitor_id: monitorId, error: errorMessage(error) })
      return { status: 500, body: { error: 'Could not start the check. Try again in a moment.', code: 'internal' } }
    }
    const monitor = monitors[0]
    if (!monitor) return { status: 404, body: { error: 'Monitor not found.', code: 'not_found' } }
    if (monitor.type === 'heartbeat') return { status: 404, body: { error: 'Heartbeat monitors have nothing to run: they wait for pings.', code: 'not_found' } }
    return { status: 409, body: { error: RUN_NOW_CONFLICT_MESSAGE, code: 'conflict' } }
  }

  const payload = parseRunPayload(row)
  if (!payload) {
    deps.log('error', 'monitor_payload_invalid', { monitor_id: monitorId })
    return { status: 500, body: { error: 'This monitor could not be run.', code: 'internal' } }
  }
  const run = await runMonitor(payload, deps)
  if (!run.persisted) return { status: 500, body: { error: 'The check ran, but its results could not be saved. Try again in a moment.', code: 'internal' } }
  return { status: 200, body: { state: run.state, results: run.results } }
}
