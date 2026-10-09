// monitor-probe: runs one check in the region it is invoked in and answers a ProbeResult.
//   POST, Authorization: Bearer <MONITOR_PROBE_SECRET or MONITOR_RUNNER_SECRET>, body: ProbeRequest.
// The runner invokes it once per region with `x-region: <region>` (Supabase regional invocation). The region reported
// is SB_REGION (set by Supabase); locally, where it is absent, the x-region header is echoed and marked simulated.
import { hasBearerSecret } from '../_shared/edge/auth.ts'
import { systemRecordLookup } from '../_shared/edge/dns.ts'
import { readEnv } from '../_shared/edge/env.ts'
import { errorResponse, jsonResponse, readJsonBody } from '../_shared/edge/http.ts'
import { errorMessage, log } from '../_shared/edge/log.ts'
import { parseProbeRequest } from '../_shared/monitoring/probe.ts'
import { errorProbeResult } from '../_shared/monitoring/runner.ts'
import type { ProbeResult } from '../_shared/monitoring/types.ts'
import { runCheck } from './checks.ts'
import type { ProbeDeps } from './checks.ts'
import { tlsHandshake } from './tls.ts'

/** Opens a TCP connection and closes it; a connection that completes after the deadline is closed too. */
export async function connectTcp(address: string, port: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason
  const pending = Deno.connect({ hostname: address, port, transport: 'tcp' })
  let onAbort = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const connection = await Promise.race([pending, aborted])
    connection.close()
  } catch (error) {
    pending.then((connection) => connection.close()).catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function defaultProbeDeps(): ProbeDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    lookup: systemRecordLookup(),
    connectTcp,
    tlsHandshake,
    secretsKey: readEnv('UPVANE_SECRETS_KEY'),
    now: () => new Date(),
    clock: () => performance.now(),
  }
}

/** SB_REGION in Supabase; elsewhere the requested x-region (simulated). */
export function probeRegion(request: Request): { region: string; simulated: boolean } {
  const actual = readEnv('SB_REGION')
  if (actual) return { region: actual, simulated: false }
  const requested = request.headers.get('x-region')?.trim().toLowerCase() ?? ''
  return { region: /^[a-z0-9-]{2,32}$/.test(requested) ? requested : 'local', simulated: true }
}

function markSimulated(result: ProbeResult, simulated: boolean): ProbeResult {
  return simulated ? { ...result, details: { ...(result.details ?? {}), region_simulated: true } } : result
}

export async function handleProbeRequest(request: Request, overrides: Partial<ProbeDeps> = {}): Promise<Response> {
  if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Send a POST request.', { Allow: 'POST' })

  const secrets = [readEnv('MONITOR_PROBE_SECRET'), readEnv('MONITOR_RUNNER_SECRET')]
  if (!secrets.some(Boolean)) {
    log('error', 'probe_not_configured', { reason: 'Set MONITOR_PROBE_SECRET or MONITOR_RUNNER_SECRET.' })
    return errorResponse(503, 'unavailable', 'The probe is not configured.')
  }
  if (!(await hasBearerSecret(request, secrets))) return errorResponse(401, 'unauthorized', 'Unauthorized.')

  const started = performance.now()
  const { region, simulated } = probeRegion(request)
  const body = await readJsonBody(request)
  const parsed = body.ok ? parseProbeRequest(body.value) : ({ ok: false, error: 'The request body is not valid JSON.' } as const)
  if (!parsed.ok) return jsonResponse(markSimulated(errorProbeResult(region, parsed.error), simulated), 400)

  let result: ProbeResult
  let status = 200
  try {
    result = await runCheck(parsed.request, region, { ...defaultProbeDeps(), ...overrides })
  } catch (error) {
    log('error', 'probe_failed', { monitor_id: parsed.request.monitor_id, type: parsed.request.type, region, error: errorMessage(error) })
    result = errorProbeResult(region, 'The probe failed unexpectedly. Try again in a moment.')
    status = 500
  }
  result = markSimulated(result, simulated)
  log('info', 'probe_check', {
    monitor_id: parsed.request.monitor_id,
    type: parsed.request.type,
    region,
    status: result.status,
    http_status: result.http_status ?? null,
    latency_ms: result.latency_ms,
    duration_ms: Math.round(performance.now() - started),
    error: result.error ?? null,
  })
  return jsonResponse(result, status)
}
