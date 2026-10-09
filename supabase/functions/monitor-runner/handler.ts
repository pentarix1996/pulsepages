// monitor-runner: POST, Authorization: Bearer <MONITOR_RUNNER_SECRET>.
//   { "source": "cron" } (default)  claims due monitors for ~25 s (pg_cron calls it every 30 s) and answers a summary.
//   { "monitor_id": "<uuid>" }      "Run now" from the dashboard: 200 { state, results } | 409 conflict | 404 not_found.
// Each monitor is probed through monitor-probe once per region (x-region header), in parallel.
import { hasBearerSecret } from '../_shared/edge/auth.ts'
import { readEnv, supabaseUrl } from '../_shared/edge/env.ts'
import { errorResponse, jsonResponse, readJsonBody, withTimeout } from '../_shared/edge/http.ts'
import { log } from '../_shared/edge/log.ts'
import { adminClientFromEnv } from '../_shared/edge/supabase.ts'
import type { AdminClient } from '../_shared/edge/supabase.ts'
import { describeNetworkError, formatDuration, isTimeoutError } from '../_shared/monitoring/probe.ts'
import { errorProbeResult, parseRegionAllowList, parseRunnerCommand, PROBE_GRACE_MS, readProbeAnswer } from '../_shared/monitoring/runner.ts'
import type { ProbeRequest, ProbeResult } from '../_shared/monitoring/types.ts'
import { runDueMonitors, runMonitorNow } from './runner.ts'
import type { RunnerDeps } from './runner.ts'

/** Calls monitor-probe in one region; every failure to get a ProbeResult becomes an `error` result. */
export function probeCaller(options: { url: string; secret: string; fetch?: typeof fetch; now?: () => Date }): RunnerDeps['probe'] {
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? (() => new Date())
  return async (region: string, request: ProbeRequest): Promise<ProbeResult> => {
    const timeoutMs = request.timeout_ms + PROBE_GRACE_MS
    try {
      return await withTimeout(timeoutMs, async (signal) => {
        const response = await fetchImpl(options.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${options.secret}`, 'Content-Type': 'application/json', 'x-region': region },
          body: JSON.stringify(request),
          signal,
        })
        const text = await response.text()
        let body: unknown = null
        try {
          body = text === '' ? null : JSON.parse(text)
        } catch {
          body = null
        }
        return readProbeAnswer(region, response.status, body, now())
      })
    } catch (error) {
      const message = isTimeoutError(error)
        ? `The probe in ${region} did not answer within ${formatDuration(timeoutMs)}.`
        : `Could not reach the probe in ${region}. ${describeNetworkError(error)}`
      return errorProbeResult(region, message, now())
    }
  }
}

export interface RunnerOverrides {
  db?: AdminClient
  probe?: RunnerDeps['probe']
  fetch?: typeof fetch
}

export async function handleRunnerRequest(request: Request, overrides: RunnerOverrides = {}): Promise<Response> {
  if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Send a POST request.', { Allow: 'POST' })

  const secret = readEnv('MONITOR_RUNNER_SECRET')
  if (!secret) {
    log('error', 'monitor_runner_not_configured', { reason: 'MONITOR_RUNNER_SECRET is not set.' })
    return errorResponse(503, 'unavailable', 'The monitor runner is not configured.')
  }
  if (!(await hasBearerSecret(request, [secret]))) return errorResponse(401, 'unauthorized', 'Unauthorized.')

  const body = await readJsonBody(request)
  if (!body.ok) return errorResponse(400, 'invalid_request', 'The request body is not valid JSON.')
  const command = parseRunnerCommand(body.value)
  if (!command.ok) return errorResponse(400, 'invalid_request', command.error)

  const db = overrides.db ?? adminClientFromEnv(overrides.fetch)
  const base = supabaseUrl()
  const probeUrl = readEnv('MONITOR_PROBE_URL') ?? (base ? `${base}/functions/v1/monitor-probe` : undefined)
  if (!db || (!overrides.probe && !probeUrl)) {
    log('error', 'monitor_runner_not_configured', { reason: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.' })
    return errorResponse(503, 'unavailable', 'The monitor runner is not configured.')
  }

  const deps: RunnerDeps = {
    db,
    probe: overrides.probe ?? probeCaller({ url: probeUrl!, secret: readEnv('MONITOR_PROBE_SECRET') ?? secret, fetch: overrides.fetch }),
    allowList: parseRegionAllowList(readEnv('MONITOR_PROBE_REGIONS')),
    now: () => new Date(),
    clock: () => performance.now(),
    log,
  }

  if (command.command.mode === 'monitor') {
    const outcome = await runMonitorNow(command.command.monitorId, deps)
    return jsonResponse(outcome.body, outcome.status)
  }
  const summary = await runDueMonitors(deps)
  return jsonResponse(summary, summary.error && summary.processed === 0 ? 500 : 200)
}
