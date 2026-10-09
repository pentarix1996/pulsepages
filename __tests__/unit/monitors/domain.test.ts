// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bytesToBase64, decryptJson, encryptJson } from '@shared/crypto.ts'
import { filterValue, PROJECT_ID, userContext, type FakeCall, type FakeHandler, type Role } from './fake-supabase'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(), createActorClient: vi.fn() }))
vi.mock('@/lib/domain/audit', () => ({ audit: vi.fn(async () => undefined) }))
vi.mock('@/lib/domain/cache', () => ({ invalidateStatusPage: vi.fn(), statusPageTag: vi.fn() }))

const { audit } = await import('@/lib/domain/audit')
const { createMonitor, getMonitor, matchRoutingRules, mergeSecretHeaders, runMonitorNow, updateMonitor, validateMonitorTarget } = await import('@/lib/domain/monitors')
const { monitorCreateInput } = await import('@/lib/domain/schemas/monitors')
const { DomainError } = await import('@/lib/domain/errors')

const KEY = bytesToBase64(new Uint8Array(32).map((_, index) => index + 1))
const MONITOR_ID = '77777777-0000-4000-8000-000000000001'
const COMPONENT_ID = '66666666-0000-4000-8000-000000000001'

const monitorRow = {
  id: MONITOR_ID,
  project_id: PROJECT_ID,
  name: 'Payments API health',
  type: 'http',
  enabled: true,
  paused_reason: null,
  interval_seconds: 60,
  timeout_ms: 10000,
  regions: ['eu-central-1', 'us-east-1'],
  confirm_failures: 2,
  confirm_regions: 1,
  recovery_successes: 2,
  config: { url: 'https://api.example.com/health', method: 'GET', headers: [{ name: 'Accept', value: 'application/json' }] },
  failure_status: 'major_outage',
  degraded_status: 'degraded',
  state: 'up',
  state_changed_at: null,
  last_checked_at: null,
  next_check_at: '2026-10-09T10:00:00+00:00',
  last_result: null,
  last_error: null,
  heartbeat_token: null,
  last_heartbeat_at: null,
  tls_expires_at: null,
  tls_checked_at: null,
  auto_draft_incident: true,
  legacy_config_id: null,
  created_by: null,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
}

const publicResolver = vi.fn(async () => ['93.184.216.34'])

/** Answers monitors/components/links/secrets like a project with one monitor and one component. */
function standardHandler(overrides: Partial<Record<string, (call: FakeCall) => ReturnType<FakeHandler>>> = {}): FakeHandler {
  return (call) => {
    const override = overrides[`${call.table}:${call.action}`] ?? overrides[call.table]
    if (override) return override(call)
    if (call.table === 'monitors' && call.action === 'insert') return { data: { ...monitorRow, ...(call.payload as object) }, error: null }
    if (call.table === 'monitors') return { data: call.single ? monitorRow : [monitorRow], error: null }
    if (call.table === 'components') return { data: [{ id: COMPONENT_ID, slug: 'payments-api' }], error: null }
    if (call.table === 'monitor_components' && call.action === 'select') {
      return { data: call.columns?.includes('component:') ? [{ monitor_id: MONITOR_ID, component: { id: COMPONENT_ID, slug: 'payments-api', name: 'Payments API', position: 0 } }] : [], error: null }
    }
    if (call.table === 'monitor_secrets' && call.action === 'select') return { data: call.single ? null : [], error: null }
    return { data: null, error: null }
  }
}

beforeEach(() => {
  process.env.UPVANE_SECRETS_KEY = KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test'
  process.env.MONITOR_RUNNER_SECRET = 'runner-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.upvane.test'
  vi.mocked(audit).mockClear()
  publicResolver.mockClear()
})

const httpInput = () =>
  monitorCreateInput.parse({
    type: 'http',
    name: 'Payments API health',
    components: ['payments-api'],
    config: { url: 'https://api.example.com/health' },
    secret_headers: [{ name: 'Authorization', value: 'Bearer top-secret' }],
  })

describe('createMonitor', () => {
  it.each<Role>(['viewer', 'responder'])('is refused to a %s', async (role) => {
    const { ctx, calls } = userContext(role, standardHandler())
    await expect(createMonitor(ctx, PROJECT_ID, httpInput(), publicResolver)).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls.some((call) => call.table === 'monitors' && call.action === 'insert')).toBe(false)
  })

  it('inserts with the user client, links components and stores encrypted secret headers with the admin client', async () => {
    const { ctx, calls } = userContext('admin', standardHandler())
    const monitor = await createMonitor(ctx, PROJECT_ID, httpInput(), publicResolver)

    const insert = calls.find((call) => call.table === 'monitors' && call.action === 'insert')!
    expect(insert.client).toBe('db')
    expect(insert.payload).toMatchObject({ project_id: PROJECT_ID, type: 'http', name: 'Payments API health', config: { url: 'https://api.example.com/health', method: 'GET' } })
    expect(insert.payload).not.toHaveProperty('interval_seconds')

    const link = calls.find((call) => call.table === 'monitor_components' && call.action === 'insert')!
    expect(link.payload).toEqual([{ monitor_id: MONITOR_ID, component_id: COMPONENT_ID }])

    const secret = calls.find((call) => call.table === 'monitor_secrets' && call.action === 'upsert')!
    expect(secret.client).toBe('admin')
    const stored = secret.payload as { headers_encrypted: string; header_names: string[] }
    expect(stored.header_names).toEqual(['Authorization'])
    expect(stored.headers_encrypted).toMatch(/^v1\./)
    expect(JSON.stringify(stored)).not.toContain('top-secret')
    expect(await decryptJson(stored.headers_encrypted, KEY)).toEqual([{ name: 'Authorization', value: 'Bearer top-secret' }])

    expect(publicResolver).toHaveBeenCalledWith('api.example.com')
    expect(audit).toHaveBeenCalledWith(ctx, expect.objectContaining({ action: 'monitor.created', targetId: MONITOR_ID }))
    expect(JSON.stringify(monitor)).not.toContain('top-secret')
  })

  it('rejects URLs whose hostname resolves to a private address, before writing anything', async () => {
    const { ctx, calls } = userContext('admin', standardHandler())
    const privateResolver = vi.fn(async () => ['93.184.216.34', '10.0.0.7'])
    const error = await createMonitor(ctx, PROJECT_ID, httpInput(), privateResolver).catch((cause) => cause)
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'invalid_request', message: 'api.example.com resolves to a private or reserved address.', details: [{ path: 'config.url' }] })
    expect(calls.some((call) => call.action === 'insert' || call.action === 'upsert')).toBe(false)
  })

  it('surfaces plan limits from the database with the plan name and a way forward', async () => {
    const { ctx } = userContext(
      'admin',
      standardHandler({ 'monitors:insert': () => ({ data: null, error: { code: 'P0001', message: 'Your free plan checks every 180 seconds at most.' } }) }),
    )
    await expect(createMonitor(ctx, PROJECT_ID, httpInput(), publicResolver)).rejects.toMatchObject({
      code: 'plan_limit',
      status: 402,
      message: 'Your Free plan checks every 180 seconds at most. Upgrade to check more often.',
    })
  })

  it('checks the linked components before creating anything', async () => {
    const { ctx, calls } = userContext('admin', standardHandler())
    const input = monitorCreateInput.parse({ type: 'heartbeat', name: 'Backup', components: ['nope'] })
    await expect(createMonitor(ctx, PROJECT_ID, input, publicResolver)).rejects.toMatchObject({ code: 'invalid_request', message: 'Component nope was not found in this status page.' })
    expect(calls.some((call) => call.table === 'monitors' && call.action === 'insert')).toBe(false)
  })

  it('refuses secret headers on monitors that do not send HTTP requests', async () => {
    const { ctx } = userContext('admin', standardHandler())
    const input = monitorCreateInput.parse({ type: 'tcp', name: 'DB', config: { host: 'db.example.com', port: 5432 }, secret_headers: [{ name: 'X-Key', value: 'k' }] })
    await expect(createMonitor(ctx, PROJECT_ID, input, publicResolver)).rejects.toMatchObject({ code: 'invalid_request', message: 'Secret headers only apply to HTTP and keyword monitors.' })
  })
})

describe('validateMonitorTarget (SSRF on save)', () => {
  it('checks TCP and TLS hosts with DNS but only hostname rules for DNS monitors', async () => {
    const resolver = vi.fn(async () => ['fd00::1'])
    await expect(validateMonitorTarget('tcp', { host: 'db.example.com', port: 5432 }, resolver)).rejects.toMatchObject({ details: [{ path: 'config.host' }] })
    await expect(validateMonitorTarget('tls', { hostname: 'api.example.com' }, resolver)).rejects.toMatchObject({ details: [{ path: 'config.hostname' }] })
    resolver.mockClear()
    await expect(validateMonitorTarget('dns', { hostname: '_dmarc.example.com' }, resolver)).resolves.toBeUndefined()
    await expect(validateMonitorTarget('heartbeat', {}, resolver)).resolves.toBeUndefined()
    expect(resolver).not.toHaveBeenCalled()
  })

  it('explains unresolvable hosts and IPv4-mapped private answers', async () => {
    await expect(validateMonitorTarget('http', { url: 'https://nope.example.com' }, async () => { throw new Error('ENOTFOUND') })).rejects.toMatchObject({ message: 'Could not resolve nope.example.com.' })
    await expect(validateMonitorTarget('http', { url: 'https://sneaky.example.com' }, async () => ['::ffff:127.0.0.1'])).rejects.toMatchObject({ message: 'sneaky.example.com resolves to a private or reserved address.' })
  })
})

describe('updateMonitor', () => {
  it('keeps the saved value of a secret header sent with value null and adds new ones', async () => {
    const saved = await encryptJson([{ name: 'Authorization', value: 'Bearer old' }, { name: 'X-Old', value: 'drop me' }], KEY)
    const { ctx, calls } = userContext(
      'admin',
      standardHandler({ 'monitor_secrets:select': (call) => ({ data: call.single ? { headers_encrypted: saved } : [{ monitor_id: MONITOR_ID, header_names: ['Authorization', 'X-Old'] }], error: null }) }),
    )
    await updateMonitor(ctx, PROJECT_ID, MONITOR_ID, { secret_headers: [{ name: 'Authorization', value: null }, { name: 'X-New', value: 'fresh' }] }, publicResolver)
    const upsert = calls.find((call) => call.table === 'monitor_secrets' && call.action === 'upsert')!
    const stored = upsert.payload as { headers_encrypted: string; header_names: string[] }
    expect(stored.header_names).toEqual(['Authorization', 'X-New'])
    expect(await decryptJson(stored.headers_encrypted, KEY)).toEqual([{ name: 'Authorization', value: 'Bearer old' }, { name: 'X-New', value: 'fresh' }])
    expect(publicResolver).not.toHaveBeenCalled()
  })

  it('removes secret headers with null and validates a new config for the monitor type', async () => {
    const { ctx, calls } = userContext('admin', standardHandler())
    await updateMonitor(ctx, PROJECT_ID, MONITOR_ID, { secret_headers: null, config: { url: 'https://status.example.com/ping', method: 'HEAD' } }, publicResolver)
    expect(calls.find((call) => call.table === 'monitor_secrets' && call.action === 'delete')?.client).toBe('admin')
    const update = calls.find((call) => call.table === 'monitors' && call.action === 'update')!
    expect(update.payload).toMatchObject({ config: { url: 'https://status.example.com/ping', method: 'HEAD', follow_redirects: true } })
    expect(filterValue(update, 'id')).toBe(MONITOR_ID)
    expect(publicResolver).toHaveBeenCalledWith('status.example.com')

    await expect(updateMonitor(ctx, PROJECT_ID, MONITOR_ID, { config: { url: 'http://plain.example.com' } }, publicResolver)).rejects.toMatchObject({
      code: 'invalid_request',
      details: [{ path: 'config.url', message: 'Only https:// URLs can be monitored.' }],
    })
  })

  it('does not turn a monitor into a heartbeat and requires the config when the type changes', async () => {
    const { ctx } = userContext('admin', standardHandler())
    await expect(updateMonitor(ctx, PROJECT_ID, MONITOR_ID, { type: 'heartbeat', config: {} }, publicResolver)).rejects.toMatchObject({ details: [{ path: 'type' }] })
    await expect(updateMonitor(ctx, PROJECT_ID, MONITOR_ID, { type: 'tcp' }, publicResolver)).rejects.toMatchObject({ details: [{ path: 'config' }] })
  })

  it('audits pause and resume as their own actions', async () => {
    const { ctx } = userContext('admin', standardHandler())
    await updateMonitor(ctx, PROJECT_ID, MONITOR_ID, { enabled: false }, publicResolver)
    expect(audit).toHaveBeenLastCalledWith(ctx, expect.objectContaining({ action: 'monitor.paused' }))
  })
})

describe('mergeSecretHeaders', () => {
  it('rejects duplicates and unknown kept values', () => {
    expect(() => mergeSecretHeaders([{ name: 'A', value: '1' }, { name: 'a', value: '2' }], [])).toThrow('a is set twice.')
    expect(() => mergeSecretHeaders([{ name: 'A', value: null }], [])).toThrow('Enter a value for the secret header A.')
    expect(() => mergeSecretHeaders([{ name: 'A', value: null }], 'unreadable')).toThrow(/cannot be read anymore/)
  })
})

describe('heartbeat URL visibility', () => {
  const heartbeatRow = { ...monitorRow, type: 'heartbeat', config: { grace_seconds: 300 }, heartbeat_token: 'abc123token456' }
  const handler = standardHandler({ monitors: (call) => ({ data: call.single ? heartbeatRow : [heartbeatRow], error: null }) })

  it('shows the ping URL to admins only', async () => {
    expect((await getMonitor(userContext('admin', handler).ctx, PROJECT_ID, MONITOR_ID)).heartbeat_url).toBe('https://app.upvane.test/api/v1/heartbeat/abc123token456')
    expect((await getMonitor(userContext('responder', handler).ctx, PROJECT_ID, MONITOR_ID)).heartbeat_url).toBeNull()
    expect((await getMonitor(userContext('viewer', handler).ctx, PROJECT_ID, MONITOR_ID)).heartbeat_url).toBeNull()
  })
})

describe('runMonitorNow', () => {
  const okFetch = vi.fn(async () =>
    Response.json({ state: 'up', results: [{ region: 'eu-central-1', status: 'up', latency_ms: 182.4, http_status: 200, checked_at: '2026-10-09T10:00:00Z' }, { region: 'us-east-1', status: 'weird' }] }),
  )

  it('is refused to viewers and allowed to responders', async () => {
    await expect(runMonitorNow(userContext('viewer', standardHandler()).ctx, PROJECT_ID, MONITOR_ID, okFetch)).rejects.toMatchObject({ code: 'forbidden' })
    const { ctx } = userContext('responder', standardHandler())
    const result = await runMonitorNow(ctx, PROJECT_ID, MONITOR_ID, okFetch)
    expect(okFetch).toHaveBeenCalledWith(
      'http://supabase.test/functions/v1/monitor-runner',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer runner-secret' }), body: JSON.stringify({ monitor_id: MONITOR_ID }) }),
    )
    expect(result.state).toBe('up')
    expect(result.results[0]).toMatchObject({ region: 'eu-central-1', status: 'up', latency_ms: 182, http_status: 200 })
    expect(result.results[1]).toMatchObject({ region: 'us-east-1', status: 'error', latency_ms: null })
    expect(audit).toHaveBeenCalledWith(ctx, expect.objectContaining({ action: 'monitor.run' }))
  })

  it('maps runner answers and configuration problems to readable errors', async () => {
    const { ctx } = userContext('responder', standardHandler())
    await expect(runMonitorNow(ctx, PROJECT_ID, MONITOR_ID, vi.fn(async () => Response.json({ error: 'This monitor ran 4 seconds ago.', code: 'conflict' }, { status: 409 })))).rejects.toMatchObject({ code: 'conflict', message: 'This monitor ran 4 seconds ago.' })
    await expect(runMonitorNow(ctx, PROJECT_ID, MONITOR_ID, vi.fn(async () => Response.json({ error: 'Unknown' }, { status: 404 })))).rejects.toMatchObject({ code: 'not_found' })
    await expect(runMonitorNow(ctx, PROJECT_ID, MONITOR_ID, vi.fn(async () => Response.json({ code: 'BOOT_ERROR' }, { status: 503 })))).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('HTTP 503, BOOT_ERROR') })
    await expect(runMonitorNow(ctx, PROJECT_ID, MONITOR_ID, vi.fn(async () => { throw new TypeError('fetch failed') }))).rejects.toMatchObject({ code: 'unavailable', message: 'The check runner is not reachable. Try again in a moment.' })
    delete process.env.MONITOR_RUNNER_SECRET
    await expect(runMonitorNow(ctx, PROJECT_ID, MONITOR_ID, okFetch)).rejects.toMatchObject({ code: 'unavailable', status: 503, message: 'Checks cannot run from here: set MONITOR_RUNNER_SECRET.' })
  })
})

describe('matchRoutingRules', () => {
  const rule = (overrides: Record<string, unknown>) => ({
    id: 'r',
    project_id: PROJECT_ID,
    name: 'Rule',
    enabled: true,
    event_types: ['monitor_down', 'monitor_degraded', 'monitor_recovered'],
    component_ids: [],
    monitor_ids: [],
    min_status: null,
    channel_ids: ['c1'],
    cooldown_minutes: 15,
    position: 0,
    created_by: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  })
  const monitor = { id: MONITOR_ID, type: 'http' as const, failure_status: 'major_outage' as const, degraded_status: 'degraded' as const, components: [{ component_id: COMPONENT_ID, slug: 'payments-api', name: 'Payments API' }] }

  it('matches like the database: event type, components, monitors and minimum status', () => {
    const rows = matchRoutingRules(
      [
        rule({ id: 'all' }),
        rule({ id: 'other-monitor', monitor_ids: ['00000000-0000-4000-8000-000000000000'] }),
        rule({ id: 'this-component', component_ids: [COMPONENT_ID] }),
        rule({ id: 'other-component', component_ids: ['00000000-0000-4000-8000-000000000000'] }),
        rule({ id: 'majors', min_status: 'partial_outage' }),
        rule({ id: 'disabled', enabled: false }),
        rule({ id: 'incidents', event_types: ['incident_created'] }),
      ] as never,
      monitor,
    )
    const ids = Object.fromEntries(rows.map((row) => [row.event, row.rules.map((item) => item.id)]))
    expect(ids.monitor_down).toEqual(['all', 'this-component', 'majors'])
    expect(ids.monitor_degraded).toEqual(['all', 'this-component'])
    expect(ids.monitor_recovered).toEqual(['all', 'this-component', 'majors'])
    expect(ids.tls_expiring).toBeUndefined()
  })
})
