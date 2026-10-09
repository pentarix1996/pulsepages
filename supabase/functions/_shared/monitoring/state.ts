// Confirmation state machine (spec §5). A region confirms a problem after `confirm_failures` bad checks in a row and
// confirms recovery after `recovery_successes` good checks in a row. The monitor goes down only when a quorum of
// regions agrees. Probe errors (the probe itself failed) are unknown: they never move a region either way.
import type { ConfirmedState, ProbeResult, RegionState } from './types.ts'

export interface ConfirmationSettings {
  confirm_failures: number
  recovery_successes: number
}

export function initialRegionState(region: string): RegionState {
  return { region, consecutive_bad: 0, consecutive_up: 0, confirmed: 'up', last_status: null, last_latency_ms: null, last_error: null }
}

export function advanceRegionState(previous: RegionState | undefined, result: ProbeResult, settings: ConfirmationSettings): RegionState {
  const base = previous ?? initialRegionState(result.region)
  const confirmFailures = Math.max(1, settings.confirm_failures)
  const recoverySuccesses = Math.max(1, settings.recovery_successes)

  if (result.status === 'error') {
    return { ...base, region: result.region, last_status: 'error', last_latency_ms: result.latency_ms, last_error: result.error ?? 'The probe could not run.' }
  }

  if (result.status === 'up') {
    const consecutiveUp = base.consecutive_up + 1
    return {
      region: result.region,
      consecutive_bad: 0,
      consecutive_up: consecutiveUp,
      confirmed: base.confirmed === 'up' || consecutiveUp >= recoverySuccesses ? 'up' : base.confirmed,
      last_status: 'up',
      last_latency_ms: result.latency_ms,
      last_error: null,
    }
  }

  const consecutiveBad = base.consecutive_bad + 1
  return {
    region: result.region,
    consecutive_bad: consecutiveBad,
    consecutive_up: 0,
    confirmed: consecutiveBad >= confirmFailures ? result.status : base.confirmed,
    last_status: result.status,
    last_latency_ms: result.latency_ms,
    last_error: result.error ?? null,
  }
}

export function quorumSize(confirmRegions: number, activeRegions: number): number {
  return Math.max(1, Math.min(confirmRegions, Math.max(1, activeRegions)))
}

export function computeMonitorState(states: RegionState[], activeRegions: string[], confirmRegions: number): ConfirmedState {
  const active = states.filter((state) => activeRegions.includes(state.region))
  const quorum = quorumSize(confirmRegions, activeRegions.length)
  const down = active.filter((state) => state.confirmed === 'down').length
  const bad = active.filter((state) => state.confirmed === 'down' || state.confirmed === 'degraded').length
  if (down >= quorum) return 'down'
  if (bad >= quorum) return 'degraded'
  return 'up'
}

export interface RunEvaluation {
  regionStates: RegionState[]
  /** Null when every probe errored and the monitor has no confirmed state yet: keep the current state. */
  state: ConfirmedState | null
  lastError: string | null
  summary: Record<string, unknown>
}

/** Applies one round of probe results (one per region) to the stored region states. */
export function evaluateRun(input: {
  previousState: string
  regions: string[]
  previous: Record<string, Partial<RegionState> | undefined>
  results: ProbeResult[]
  settings: ConfirmationSettings & { confirm_regions: number }
}): RunEvaluation {
  const regionStates: RegionState[] = []
  for (const region of input.regions) {
    const stored = input.previous[region]
    const previous: RegionState | undefined = stored
      ? {
          region,
          consecutive_bad: Number(stored.consecutive_bad ?? 0),
          consecutive_up: Number(stored.consecutive_up ?? 0),
          confirmed: (stored.confirmed as ConfirmedState | undefined) ?? 'up',
          last_status: stored.last_status ?? null,
        }
      : undefined
    const result = input.results.find((item) => item.region === region)
    regionStates.push(result ? advanceRegionState(previous, result, input.settings) : previous ?? initialRegionState(region))
  }

  const everyProbeErrored = input.results.length > 0 && input.results.every((result) => result.status === 'error')
  const hasConfirmedHistory = input.previousState === 'up' || input.previousState === 'degraded' || input.previousState === 'down'
  const state = everyProbeErrored && !hasConfirmedHistory ? null : computeMonitorState(regionStates, input.regions, input.settings.confirm_regions)

  const failing = input.results.filter((result) => result.status === 'down' || result.status === 'degraded')
  const lastError = failing[0]?.error ?? (state && state !== 'up' ? regionStates.find((item) => item.last_error)?.last_error ?? null : null)

  const latencies = input.results.map((result) => result.latency_ms).filter((value): value is number => typeof value === 'number')
  const summary = {
    checked_at: new Date().toISOString(),
    regions: Object.fromEntries(input.results.map((result) => [result.region, result.status])),
    latency_ms: latencies.length > 0 ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
    max_latency_ms: latencies.length > 0 ? Math.max(...latencies) : null,
    http_status: input.results.find((result) => typeof result.http_status === 'number')?.http_status ?? null,
    quorum: quorumSize(input.settings.confirm_regions, input.regions.length),
  }

  return { regionStates, state, lastError, summary }
}
