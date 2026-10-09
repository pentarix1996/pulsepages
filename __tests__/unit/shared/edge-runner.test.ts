// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { evaluateRun } from '@shared/monitoring/state.ts'
import {
  buildProbeRequest,
  drainWithBudget,
  earliestTlsExpiry,
  errorProbeResult,
  mapWithConcurrency,
  normalizeProbeResult,
  probeRequestBody,
  parseRegionAllowList,
  parseRunnerCommand,
  parseRunPayload,
  readProbeAnswer,
  readProbeAnswers,
  selectProbeRegions,
} from '@shared/monitoring/runner.ts'

const now = new Date('2026-10-09T12:00:00Z')
const monitorId = '77777777-0000-4000-8000-000000000001'

const claimRow = {
  id: monitorId,
  project_id: '44444444-4444-4444-8444-444444444444',
  name: 'Payments API health',
  type: 'http',
  config: { url: 'https://api.example.com/health' },
  regions: ['eu-central-1', 'us-east-1'],
  timeout_ms: 8000,
  interval_seconds: 60,
  confirm_failures: 2,
  confirm_regions: 2,
  recovery_successes: 2,
  state: 'up',
  tls_checked_at: null,
  secret_headers: 'v1.abc.def',
  region_states: { 'eu-central-1': { consecutive_bad: 1, consecutive_up: 0, confirmed: 'up', last_status: 'down' } },
}

describe('parseRunnerCommand', () => {
  it('defaults to cron and recognises "Run now"', () => {
    expect(parseRunnerCommand(undefined)).toEqual({ ok: true, command: { mode: 'cron' } })
    expect(parseRunnerCommand({ source: 'cron' })).toEqual({ ok: true, command: { mode: 'cron' } })
    expect(parseRunnerCommand({ monitor_id: monitorId.toUpperCase() })).toEqual({ ok: true, command: { mode: 'monitor', monitorId } })
    expect(parseRunnerCommand({ monitor_id: 'abc' })).toEqual({ ok: false, error: 'monitor_id must be a UUID.' })
    expect(parseRunnerCommand([1])).toMatchObject({ ok: false })
  })
})

describe('regions', () => {
  it('applies the MONITOR_PROBE_REGIONS allow-list', () => {
    expect(parseRegionAllowList(undefined)).toBeNull()
    expect(parseRegionAllowList(' , ')).toBeNull()
    const allow = parseRegionAllowList('eu-central-1, US-EAST-1,eu-central-1')
    expect(allow).toEqual(['eu-central-1', 'us-east-1'])
    expect(selectProbeRegions(['eu-central-1', 'ap-south-1', 'us-east-1'], allow)).toEqual({ probe: ['eu-central-1', 'us-east-1'], skipped: ['ap-south-1'] })
    expect(selectProbeRegions(['eu-central-1'], null)).toEqual({ probe: ['eu-central-1'], skipped: [] })
  })
})

describe('parseRunPayload', () => {
  it('accepts claim rows and builds the probe request', () => {
    const payload = parseRunPayload(claimRow)
    expect(payload).toMatchObject({ id: monitorId, type: 'http', regions: ['eu-central-1', 'us-east-1'], timeout_ms: 8000, secret_headers: 'v1.abc.def' })
    expect(buildProbeRequest(payload!)).toEqual({ monitor_id: monitorId, type: 'http', config: { url: 'https://api.example.com/health' }, timeout_ms: 8000, secret_headers: 'v1.abc.def' })
  })

  it('rejects rows that cannot be run', () => {
    expect(parseRunPayload(null)).toBeNull()
    expect(parseRunPayload({ ...claimRow, id: 'nope' })).toBeNull()
    expect(parseRunPayload({ ...claimRow, type: 'ftp' })).toBeNull()
    expect(parseRunPayload({ ...claimRow, regions: [] })).toBeNull()
    expect(parseRunPayload({ ...claimRow, timeout_ms: null, region_states: null })).toMatchObject({ timeout_ms: 10_000, region_states: {} })
  })
})

describe('probe answers', () => {
  it('cleans results so SQL integer columns accept them', () => {
    const result = normalizeProbeResult('us-east-1', { region: 'us-east-1', status: 'degraded', latency_ms: 1234.56, http_status: 200.5, error: 'Slow.', checked_at: 'garbage', tls_expires_at: '2027-01-01T00:00:00Z', details: { redirects: 1 } }, now)
    expect(result).toEqual({ region: 'us-east-1', status: 'degraded', latency_ms: 1235, http_status: null, error: 'Slow.', checked_at: now.toISOString(), tls_expires_at: '2027-01-01T00:00:00.000Z', details: { redirects: 1 } })
    expect(normalizeProbeResult('us-east-1', { status: 'success' })).toBeNull()
  })

  it('attributes results to the requested region', () => {
    const result = normalizeProbeResult('ap-south-1', { region: 'eu-central-1', status: 'up', latency_ms: 80, checked_at: now.toISOString() }, now)
    expect(result).toMatchObject({ region: 'ap-south-1', details: { executed_region: 'eu-central-1' } })
  })

  it('turns every failure to get a result into an error result', () => {
    const ok = readProbeAnswer('eu-central-1', 200, { region: 'eu-central-1', status: 'down', latency_ms: null, error: 'Connection refused.', checked_at: now.toISOString() }, now)
    expect(ok).toMatchObject({ status: 'down', error: 'Connection refused.' })
    expect(readProbeAnswer('eu-central-1', 200, '<html>', now)).toMatchObject({ status: 'error', error: 'The probe in eu-central-1 answered without a valid result.' })
    expect(readProbeAnswer('eu-central-1', 401, { error: 'Unauthorized.', code: 'unauthorized' }, now)).toMatchObject({ status: 'error', error: 'The probe in eu-central-1 answered HTTP 401: Unauthorized.' })
    expect(readProbeAnswer('eu-central-1', 502, null, now)).toMatchObject({ status: 'error', error: 'The probe in eu-central-1 answered HTTP 502.' })
    expect(readProbeAnswer('eu-central-1', 503, { code: 'BOOT_ERROR', message: 'Worker failed to boot' }, now).error).toBe('The probe in eu-central-1 answered HTTP 503: Worker failed to boot')
    expect(readProbeAnswer('eu-central-1', 500, { region: 'eu-central-1', status: 'error', latency_ms: null, error: 'UPVANE_SECRETS_KEY is not set.', checked_at: now.toISOString() }, now)).toMatchObject({ status: 'error', error: 'UPVANE_SECRETS_KEY is not set.' })
    // A 5xx never counts as a real down, even if the body says so.
    expect(readProbeAnswer('eu-central-1', 503, { region: 'eu-central-1', status: 'down', latency_ms: 5, checked_at: now.toISOString() }, now).status).toBe('error')
  })

  it('error results never move the state machine', () => {
    const payload = parseRunPayload(claimRow)!
    const results = [errorProbeResult('eu-central-1', 'The probe in eu-central-1 did not answer.', now), readProbeAnswer('us-east-1', 200, { status: 'down', latency_ms: 30, error: 'Status 503 is not 200-399.' }, now)]
    const evaluation = evaluateRun({ previousState: payload.state, regions: payload.regions, previous: payload.region_states, results, settings: { confirm_failures: 2, recovery_successes: 2, confirm_regions: 2 } })
    expect(evaluation.state).toBe('up')
    expect(evaluation.regionStates.find((state) => state.region === 'eu-central-1')).toMatchObject({ consecutive_bad: 1, last_status: 'error' })
    expect(evaluation.lastError).toBe('Status 503 is not 200-399.')
  })

  it('picks the earliest certificate expiry', () => {
    expect(earliestTlsExpiry([errorProbeResult('a', 'x', now), { region: 'b', status: 'up', latency_ms: 1, checked_at: '', tls_expires_at: '2027-03-01T00:00:00Z' }, { region: 'c', status: 'up', latency_ms: 1, checked_at: '', tls_expires_at: '2027-01-01T00:00:00Z' }])).toBe('2027-01-01T00:00:00.000Z')
    expect(earliestTlsExpiry([])).toBeNull()
  })
})

describe('drainWithBudget', () => {
  it('claims until empty and limits concurrency', async () => {
    const batches = [[1, 2, 3, 4, 5], [6, 7], []]
    let inFlight = 0
    let maxInFlight = 0
    const seen: number[] = []
    const stats = await drainWithBudget(
      async () => batches.shift() ?? [],
      async (item: number) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 2))
        seen.push(item)
        inFlight -= 1
      },
      { concurrency: 2, budgetMs: 60_000 },
    )
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(maxInFlight).toBe(2)
    expect(stats).toMatchObject({ claimed: 7, processed: 7, batches: 3, budgetExhausted: false, claimError: null })
  })

  it('stops claiming when the budget is spent but finishes what it claimed', async () => {
    let clock = 0
    let claims = 0
    const processed: number[] = []
    const stats = await drainWithBudget(
      async () => {
        claims += 1
        return [claims * 10, claims * 10 + 1]
      },
      async (item: number) => {
        clock += 600
        processed.push(item)
      },
      { concurrency: 1, budgetMs: 1000, now: () => clock },
    )
    expect(claims).toBe(1)
    expect(processed).toEqual([10, 11])
    expect(stats.budgetExhausted).toBe(true)
  })

  it('survives failing claims and failing items', async () => {
    const claimFailure = await drainWithBudget(
      async () => {
        throw new Error('db down')
      },
      async () => undefined,
      { concurrency: 3, budgetMs: 1000 },
    )
    expect(claimFailure).toMatchObject({ claimed: 0, processed: 0, claimError: new Error('db down') })

    const batches = [['a', 'b'], []]
    const itemFailure = await drainWithBudget(
      async () => batches.shift() ?? [],
      async (item: string) => {
        if (item === 'a') throw new Error('boom')
      },
      { concurrency: 1, budgetMs: 1000 },
    )
    expect(itemFailure).toMatchObject({ claimed: 2, processed: 2 })
  })
})

describe('probe batches', () => {
  const request = buildProbeRequest(parseRunPayload(claimRow)!)

  it('sends a single check as before and several as a batch', () => {
    expect(probeRequestBody([request])).toEqual(request)
    expect(probeRequestBody([request, request])).toEqual({ requests: [request, request] })
  })

  it('maps batch answers in order and fails every check on an unusable answer', () => {
    const up = { region: 'x', status: 'up', latency_ms: 10.4, http_status: 200, error: null, checked_at: now.toISOString() }
    const answers = readProbeAnswers('eu-central-1', 200, { results: [up, { status: 'nope' }] }, 2, now)
    expect(answers.map((answer) => [answer.region, answer.status, answer.latency_ms])).toEqual([
      ['eu-central-1', 'up', 10],
      ['eu-central-1', 'error', null],
    ])
    expect(readProbeAnswers('eu-central-1', 200, { results: [up] }, 2, now).every((answer) => answer.status === 'error')).toBe(true)
    expect(readProbeAnswers('eu-central-1', 503, { error: 'Busy' }, 3, now).map((answer) => answer.error)).toEqual(Array(3).fill('The probe in eu-central-1 answered HTTP 503: Busy'))
    expect(readProbeAnswers('eu-central-1', 200, up, 1, now)[0]!.status).toBe('up')
  })

  it('runs work with bounded concurrency and keeps order', async () => {
    let running = 0
    let peak = 0
    const out = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (ms, index) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, ms))
      running -= 1
      return index
    })
    expect(out).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([])
  })
})
