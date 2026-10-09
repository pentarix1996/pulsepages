import { assertEquals, assertStringIncludes } from '@std/assert'
import { silentLogger } from '../_shared/edge/log.ts'
import { DatabaseError } from '../_shared/edge/supabase.ts'
import type { AdminClient } from '../_shared/edge/supabase.ts'
import type { ProbeRequest, ProbeResult } from '../_shared/monitoring/types.ts'
import { handleRunnerRequest, probeCaller } from './handler.ts'
import { runDueMonitors, runMonitor, runMonitorNow } from './runner.ts'
import type { RunnerDeps } from './runner.ts'
import { parseRunPayload } from '../_shared/monitoring/runner.ts'

const NOW = new Date('2026-10-09T12:00:00Z')
const MONITOR_ID = '77777777-0000-4000-8000-0000000000a1'

const claimRow = (overrides: Record<string, unknown> = {}) => ({
  id: MONITOR_ID,
  project_id: '44444444-4444-4444-8444-444444444444',
  name: 'Payments API',
  type: 'http',
  config: { url: 'https://api.example.com/health' },
  regions: ['eu-central-1', 'us-east-1', 'ap-southeast-1'],
  timeout_ms: 8000,
  interval_seconds: 60,
  confirm_failures: 1,
  confirm_regions: 2,
  recovery_successes: 1,
  state: 'up',
  tls_checked_at: null,
  secret_headers: null,
  region_states: {},
  ...overrides,
})

interface Call {
  fn: string
  args: Record<string, unknown>
}

function fakeDb(rpcs: Record<string, (args: Record<string, unknown>) => unknown>, tables: Record<string, unknown[]> = {}) {
  const calls: Call[] = []
  const db: AdminClient = {
    rpc: async <T>(fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args })
      const handler = rpcs[fn]
      if (!handler) throw new DatabaseError(`rpc ${fn}: not stubbed`, 'PGRST202', 404)
      return (await handler(args)) as T
    },
    select: async <T>(table: string, query: Record<string, string>) => {
      calls.push({ fn: `select ${table}`, args: query })
      return (tables[table] ?? []) as T[]
    },
  }
  return { db, calls }
}

const result = (region: string, status: ProbeResult['status'], extra: Partial<ProbeResult> = {}): ProbeResult => ({
  region,
  status,
  latency_ms: status === 'error' ? null : 120,
  http_status: status === 'error' ? null : status === 'down' ? 503 : 200,
  error: status === 'down' ? 'Status 503 is not 200-399.' : null,
  checked_at: NOW.toISOString(),
  ...extra,
})

function deps(db: AdminClient, probe: RunnerDeps['probe'], allowList: string[] | null = null): RunnerDeps {
  let time = 0
  return { db, probe, allowList, now: () => NOW, clock: () => (time += 5), log: silentLogger }
}

Deno.test('runMonitor probes every region in parallel and records the evaluated run', async () => {
  const { db, calls } = fakeDb({ record_monitor_run: () => null })
  const probed: Array<{ region: string; request: ProbeRequest }> = []
  const statuses: Record<string, ProbeResult['status']> = { 'eu-central-1': 'down', 'us-east-1': 'down', 'ap-southeast-1': 'up' }
  const run = await runMonitor(parseRunPayload(claimRow())!, deps(db, async (region, request) => {
    probed.push({ region, request })
    return result(region, statuses[region]!)
  }))
  assertEquals(probed.map((entry) => entry.region), ['eu-central-1', 'us-east-1', 'ap-southeast-1'])
  assertEquals(probed[0]!.request, { monitor_id: MONITOR_ID, type: 'http', config: { url: 'https://api.example.com/health' }, timeout_ms: 8000, secret_headers: null })
  assertEquals([run.state, run.persisted], ['down', true])

  const record = calls.find((call) => call.fn === 'record_monitor_run')!.args
  assertEquals(record.p_monitor_id, MONITOR_ID)
  assertEquals(record.p_state, 'down')
  assertEquals(record.p_last_error, 'Status 503 is not 200-399.')
  assertEquals(record.p_tls_expires_at, null)
  assertEquals((record.p_results as ProbeResult[]).length, 3)
  assertEquals((record.p_region_states as Array<{ region: string; confirmed: string }>).map((state) => [state.region, state.confirmed]), [
    ['eu-central-1', 'down'],
    ['us-east-1', 'down'],
    ['ap-southeast-1', 'up'],
  ])
  assertEquals((record.p_summary as { quorum: number; regions: Record<string, string> }).quorum, 2)
})

Deno.test('runMonitor keeps the state when every probe errored on a pending monitor and passes TLS expiry', async () => {
  const { db, calls } = fakeDb({ record_monitor_run: () => null })
  const pending = await runMonitor(parseRunPayload(claimRow({ state: 'pending' }))!, deps(db, async (region) => result(region, 'error', { error: 'The probe did not answer.' })))
  assertEquals(pending.state, null)
  assertEquals(calls[0]!.args.p_state, null)

  const tls = await runMonitor(
    parseRunPayload(claimRow({ type: 'tls', regions: ['eu-central-1'], config: { hostname: 'api.example.com' } }))!,
    deps(db, async (region) => result(region, 'degraded', { tls_expires_at: '2026-10-20T00:00:00.000Z', error: 'The certificate expires in 10 days (2026-10-20).' })),
  )
  assertEquals(tls.state, 'degraded')
  assertEquals(calls[1]!.args.p_tls_expires_at, '2026-10-20T00:00:00.000Z')
})

Deno.test('runMonitor honours MONITOR_PROBE_REGIONS and explains when no region can be probed', async () => {
  const { db, calls } = fakeDb({ record_monitor_run: () => null })
  const probed: string[] = []
  const probe: RunnerDeps['probe'] = async (region) => {
    probed.push(region)
    return result(region, 'up')
  }
  await runMonitor(parseRunPayload(claimRow())!, deps(db, probe, ['us-east-1']))
  assertEquals(probed, ['us-east-1'])
  assertEquals((calls[0]!.args.p_summary as { skipped_regions: string[] }).skipped_regions, ['eu-central-1', 'ap-southeast-1'])

  const none = await runMonitor(parseRunPayload(claimRow({ regions: ['sa-east-1'], state: 'pending' }))!, deps(db, probe, ['us-east-1']))
  assertEquals(probed.length, 1)
  assertEquals(none.results.map((entry) => entry.status), ['error'])
  assertStringIncludes(none.results[0]!.error ?? '', 'MONITOR_PROBE_REGIONS')
})

Deno.test('runMonitorNow implements the dashboard contract', async () => {
  const probe: RunnerDeps['probe'] = async (region) => result(region, 'up')

  const missing = fakeDb({ claim_monitor: () => null })
  assertEquals(await runMonitorNow(MONITOR_ID, deps(missing.db, probe)), { status: 404, body: { error: 'Monitor not found.', code: 'not_found' } })
  assertEquals(missing.calls[1], { fn: 'select monitors', args: { select: 'id,type', id: `eq.${MONITOR_ID}`, limit: '1' } })

  const heartbeat = fakeDb({ claim_monitor: () => null }, { monitors: [{ id: MONITOR_ID, type: 'heartbeat' }] })
  assertEquals((await runMonitorNow(MONITOR_ID, deps(heartbeat.db, probe))).status, 404)

  const recent = fakeDb({ claim_monitor: () => null }, { monitors: [{ id: MONITOR_ID, type: 'http' }] })
  assertEquals(await runMonitorNow(MONITOR_ID, deps(recent.db, probe)), {
    status: 409,
    body: { error: 'This monitor ran a few seconds ago. Try again in a moment.', code: 'conflict' },
  })

  const ok = fakeDb({ claim_monitor: () => claimRow({ regions: ['eu-central-1'] }), record_monitor_run: () => null })
  assertEquals(await runMonitorNow(MONITOR_ID, deps(ok.db, probe)), { status: 200, body: { state: 'up', results: [result('eu-central-1', 'up')] } })

  const unsaved = fakeDb({ claim_monitor: () => claimRow({ regions: ['eu-central-1'] }) })
  assertEquals((await runMonitorNow(MONITOR_ID, deps(unsaved.db, probe))).status, 500)
})

Deno.test('runDueMonitors drains batches and summarises the run', async () => {
  const batches = [[claimRow(), claimRow({ id: '77777777-0000-4000-8000-0000000000a2', state: 'pending' }), { id: 'broken' }], []]
  const { db, calls } = fakeDb({ claim_due_monitors: () => batches.shift() ?? [], record_monitor_run: () => null })
  const summary = await runDueMonitors(deps(db, async (region) => result(region, 'up')), { batchSize: 25, concurrency: 8, budgetMs: 25_000 })
  assertEquals(calls.filter((call) => call.fn === 'claim_due_monitors').map((call) => call.args), [{ p_limit: 25 }, { p_limit: 25 }])
  assertEquals(summary.claimed, 3)
  assertEquals(summary.processed, 3)
  assertEquals(summary.persisted, 2)
  assertEquals(summary.failed, 1)
  assertEquals(summary.states, { up: 2, degraded: 0, down: 0, unknown: 0 })

  const broken = fakeDb({})
  const failure = await runDueMonitors(deps(broken.db, async (region) => result(region, 'up')))
  assertEquals([failure.claimed, failure.error], [0, 'Could not claim due monitors.'])
})

Deno.test('probeCaller turns probe failures into error results', async () => {
  const request: ProbeRequest = { monitor_id: MONITOR_ID, type: 'http', config: {}, timeout_ms: 1000, secret_headers: null }
  let seen: Headers | null = null
  const good = probeCaller({
    url: 'http://kong:8000/functions/v1/monitor-probe',
    secret: 'probe-secret',
    now: () => NOW,
    fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
      seen = new Headers(init?.headers)
      return Response.json(result('us-east-1', 'up', { latency_ms: 87.6 }))
    }) as typeof fetch,
  })
  const answer = await good('us-east-1', request)
  assertEquals([answer.status, answer.latency_ms], ['up', 88])
  assertEquals([seen!.get('x-region'), seen!.get('authorization')], ['us-east-1', 'Bearer probe-secret'])

  const crashed = probeCaller({ url: 'http://probe', secret: 's', now: () => NOW, fetch: (async () => new Response('Bad gateway', { status: 502 })) as typeof fetch })
  assertEquals(await crashed('eu-central-1', request), { region: 'eu-central-1', status: 'error', latency_ms: null, http_status: null, error: 'The probe in eu-central-1 answered HTTP 502.', checked_at: NOW.toISOString() })

  const unreachable = probeCaller({ url: 'http://probe', secret: 's', now: () => NOW, fetch: (async () => Promise.reject(new TypeError('fetch failed', { cause: new Error('dns error: failed to lookup address information') }))) as typeof fetch })
  assertEquals((await unreachable('eu-central-1', request)).error, 'Could not reach the probe in eu-central-1. Could not resolve the host.')

  // The runner waits timeout_ms + 5 s; a negative timeout keeps this test fast.
  const silent = probeCaller({
    url: 'http://probe',
    secret: 's',
    now: () => NOW,
    fetch: ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as typeof fetch,
  })
  assertEquals((await silent('eu-central-1', { ...request, timeout_ms: -4970 })).error, 'The probe in eu-central-1 did not answer within 30 ms.')
})

Deno.test('handler: secret, body validation and run-now through HTTP', async () => {
  Deno.env.set('MONITOR_RUNNER_SECRET', 'runner-secret')
  try {
    const call = (body: string, token = 'runner-secret') => new Request('http://localhost/monitor-runner', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body })
    const { db } = fakeDb({ claim_monitor: () => null }, { monitors: [{ id: MONITOR_ID, type: 'http' }] })
    const overrides = { db, probe: async (region: string) => result(region, 'up') }
    assertEquals((await handleRunnerRequest(call('{}', 'wrong'), overrides)).status, 401)
    assertEquals((await handleRunnerRequest(call('{nope'), overrides)).status, 400)
    assertEquals((await handleRunnerRequest(call('{"monitor_id":"x"}'), overrides)).status, 400)
    const conflict = await handleRunnerRequest(call(JSON.stringify({ monitor_id: MONITOR_ID })), overrides)
    assertEquals([conflict.status, (await conflict.json()).code], [409, 'conflict'])
  } finally {
    Deno.env.delete('MONITOR_RUNNER_SECRET')
  }
})
