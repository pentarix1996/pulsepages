// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasRole, type OrgRole } from '@shared/domain.ts'
import { forbidden } from '@/lib/domain/errors'
import { sloCreateInput, sloUpdateInput } from '@/lib/domain/schemas/metrics'
import { apiKeyCtx, fakeDb, filterValue, userCtx, type QueryCall, type QueryResult } from '../projects/fake-db'

const state = vi.hoisted(() => ({ role: 'owner' as string, createdAt: '2026-10-08T10:00:00Z' }))

vi.mock('@/lib/domain/audit', () => ({ audit: vi.fn(async () => undefined) }))
vi.mock('@/lib/domain/cache', () => ({ invalidateStatusPage: vi.fn() }))
vi.mock('@/lib/domain/access', () => ({
  isUuid: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  requireWriteScope: () => undefined,
  listMemberships: vi.fn(async () => []),
  requireOrganization: vi.fn(),
  requireProject: vi.fn(async (_ctx: unknown, _ref: string, minRole: OrgRole = 'viewer') => {
    if (!hasRole(state.role, minRole)) throw forbidden(`You need the ${minRole} role or higher to do this.`)
    return {
      project: {
        id: PROJECT,
        organization_id: 'org-1',
        name: 'Quillbase status',
        slug: 'status',
        timezone: 'Europe/Madrid',
        visibility: 'public',
        custom_domain: null,
        custom_domain_status: 'none',
        created_at: state.createdAt,
      },
      organization: { id: 'org-1', name: 'Quillbase', slug: 'quillbase', plan: 'business', personal: false, sso_domain: null, require_2fa: false },
      role: state.role,
    }
  }),
}))

const PROJECT = '44444444-4444-4444-8444-444444444444'
const COMPONENT = '66666666-0000-4000-8000-000000000001'
const SLO = '2a6528fd-e6eb-4a9e-a098-ef19491fbcb7'

const { audit } = await import('@/lib/domain/audit')
const access = await import('@/lib/domain/access')
const { exportReportCsv, getProjectMetrics, resolveMetricsRange } = await import('@/lib/domain/metrics')
const { createSlo, deleteSlo, listSlos, updateSlo } = await import('@/lib/domain/slos')
const { getProjectStatus } = await import('@/lib/domain/projects')
const { getOverview } = await import('@/lib/domain/overview')

const emptyMetrics = { from: '2026-09-09T00:00:00Z', to: '2026-10-09T00:00:00Z', uptime: 100, components: [], incidents: { total: 0, by_impact: {}, mtta_seconds: null, mttr_seconds: null, longest_seconds: null, list: [] }, slos: [] }

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'owner'
  state.createdAt = '2026-10-08T10:00:00Z'
})

describe('resolveMetricsRange', () => {
  const now = new Date('2026-10-09T12:00:00Z')

  it('defaults to the 30 days before now', () => {
    const range = resolveMetricsRange({}, now)
    expect(range.to).toEqual(now)
    expect(range.from.toISOString()).toBe('2026-09-09T12:00:00.000Z')
  })

  it('reads dates as UTC midnight and clamps the end to now', () => {
    const range = resolveMetricsRange({ from: '2026-09-01', to: '2027-01-01T00:00:00Z' }, now)
    expect(range.from.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(range.to).toEqual(now)
  })

  it('rejects reversed, empty and too long ranges', () => {
    expect(() => resolveMetricsRange({ from: '2026-10-05', to: '2026-10-01' }, now)).toThrow(/earlier than to/)
    expect(() => resolveMetricsRange({ from: '2026-10-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }, now)).toThrow(/earlier than to/)
    expect(() => resolveMetricsRange({ from: '2025-09-01', to: '2026-10-09' }, now)).toThrow('Use a range of at most 400 days.')
    expect(() => resolveMetricsRange({ from: '2025-09-04', to: '2026-10-09' }, now)).not.toThrow()
  })
})

describe('getProjectMetrics', () => {
  it('passes the validated range to get_project_metrics and normalizes numbers', async () => {
    const { db, calls } = fakeDb((call) => (call.op === 'rpc' ? { data: { ...emptyMetrics, uptime: '99.962', slos: [{ id: SLO, name: 'Page', target: '99.900', window_days: 30, component_id: null, actual: '99.95', allowed_downtime_seconds: 2592, consumed_downtime_seconds: 900, budget_remaining: '0.6528' }] } } : {}))
    const metrics = await getProjectMetrics(apiKeyCtx(db, { scopes: ['read'] }), 'status', { from: '2026-09-01', to: '2026-09-30' })
    const rpc = calls.find((call) => call.op === 'rpc')!
    expect(rpc.table).toBe('get_project_metrics')
    expect(rpc.payload).toEqual({ p_project_id: PROJECT, p_from: '2026-09-01T00:00:00.000Z', p_to: '2026-09-30T00:00:00.000Z' })
    expect(metrics.uptime).toBe(99.962)
    expect(metrics.slos[0]).toMatchObject({ target: 99.9, actual: 99.95, budget_remaining: 0.6528 })
    expect(access.requireProject).toHaveBeenCalledWith(expect.anything(), 'status', 'viewer')
  })

  it('does not query when the range is invalid', async () => {
    const { db, calls } = fakeDb(() => ({}))
    await expect(getProjectMetrics(userCtx(db), PROJECT, { from: '2020-01-01' })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(calls).toHaveLength(0)
  })
})

describe('exportReportCsv', () => {
  it('lets viewers export and names the file after the page and range', async () => {
    state.role = 'viewer'
    const { db } = fakeDb((call) => (call.op === 'rpc' ? { data: emptyMetrics } : { data: [] }))
    const result = await exportReportCsv(userCtx(db), PROJECT, { from: '2026-09-01', to: '2026-10-01' }, 'incidents')
    expect(result.filename).toBe('upvane-status-incidents-2026-09-01-to-2026-10-01.csv')
    expect(result.csv.startsWith('id,title,impact,status,')).toBe(true)
  })
})

describe('SLO input', () => {
  it('validates targets and windows', () => {
    expect(sloCreateInput.parse({ name: 'API', target: 99.95 })).toEqual({ name: 'API', target: 99.95, window_days: 30 })
    expect(sloCreateInput.safeParse({ name: 'API', target: 100 }).success).toBe(false)
    expect(sloCreateInput.safeParse({ name: 'API', target: 0 }).success).toBe(false)
    expect(sloCreateInput.safeParse({ name: 'API', target: 99.9999 }).success).toBe(false)
    expect(sloCreateInput.safeParse({ name: 'API', target: '99.9' }).success).toBe(false)
    expect(sloCreateInput.safeParse({ name: 'API', target: 99.9, window_days: 31 }).success).toBe(false)
    expect(sloCreateInput.parse({ name: 'API', target: 99.9, window_days: 90, component_id: '' }).component_id).toBeNull()
    expect(sloUpdateInput.parse({})).toEqual({})
  })
})

function sloDb(extra: (call: QueryCall) => QueryResult | undefined = () => undefined) {
  return fakeDb((call) => {
    const answer = extra(call)
    if (answer) return answer
    if (call.op === 'rpc') return { data: [{ id: SLO, name: 'Payments', target: 99.95, window_days: 30, component_id: COMPONENT, actual: 99.99, allowed_downtime_seconds: 1296, consumed_downtime_seconds: 120, budget_remaining: 0.9074 }] }
    if (call.table === 'components') return { data: { id: COMPONENT } }
    if (call.table === 'slos') {
      const row = { id: SLO, project_id: PROJECT, component_id: COMPONENT, name: 'Payments', target: 99.95, window_days: 30, created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }
      if (call.op === 'delete') return { data: [{ id: SLO }] }
      return { data: call.single ? row : [row] }
    }
    return {}
  })
}

describe('SLOs', () => {
  it('lists with the live error budget for viewers', async () => {
    state.role = 'viewer'
    const { db } = sloDb()
    const slos = await listSlos(userCtx(db), PROJECT)
    expect(slos).toEqual([expect.objectContaining({ id: SLO, target: 99.95, budget_remaining: 0.9074, actual: 99.99 })])
  })

  it('needs the admin role to create, update or delete', async () => {
    state.role = 'responder'
    const { db, calls } = sloDb()
    await expect(createSlo(userCtx(db), PROJECT, { name: 'API', target: 99.9, window_days: 30 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(updateSlo(userCtx(db), PROJECT, SLO, { target: 99 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(deleteSlo(userCtx(db), PROJECT, SLO)).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toHaveLength(0)
  })

  it('resolves the component key inside the page and audits', async () => {
    const { db, calls } = sloDb()
    await createSlo(userCtx(db), PROJECT, { name: 'Payments', target: 99.95, window_days: 30, component_id: 'payments-api' })
    const lookup = calls.find((call) => call.table === 'components')!
    expect(filterValue(lookup, 'eq', 'project_id')).toBe(PROJECT)
    expect(filterValue(lookup, 'eq', 'slug')).toBe('payments-api')
    expect(calls.find((call) => call.op === 'insert')?.payload).toEqual({ project_id: PROJECT, component_id: COMPONENT, name: 'Payments', target: 99.95, window_days: 30 })
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'slo.created' }))
  })

  it('rejects components of other pages', async () => {
    const { db, calls } = sloDb((call) => (call.table === 'components' ? { data: null } : undefined))
    await expect(createSlo(userCtx(db), PROJECT, { name: 'X', target: 99.9, window_days: 30, component_id: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(calls.some((call) => call.op === 'insert')).toBe(false)
  })

  it('can widen a component SLO to the whole page', async () => {
    const { db, calls } = sloDb()
    await updateSlo(userCtx(db), PROJECT, SLO, { component_id: null, window_days: 7 })
    expect(calls.find((call) => call.op === 'update')?.payload).toEqual({ window_days: 7, component_id: null })
  })

  it('treats unknown ids as not found', async () => {
    const { db } = sloDb()
    await expect(deleteSlo(userCtx(db), PROJECT, 'not-a-uuid')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('getProjectStatus', () => {
  it('summarizes the worst status, the headline, incidents with public links and current maintenance', async () => {
    state.role = 'viewer'
    const { db } = fakeDb((call) => {
      if (call.table === 'components') return { data: [
        { id: 'c2', slug: 'webhooks', name: 'Webhooks', status: 'partial_outage', group_id: 'g2', position: 0 },
        { id: 'c1', slug: 'api', name: 'API', status: 'degraded', group_id: 'g1', position: 0 },
        { id: 'c3', slug: 'cdn', name: 'CDN', status: 'operational', group_id: null, position: 0 },
      ] }
      if (call.table === 'component_groups') return { data: [{ id: 'g1', position: 0, name: 'Core' }, { id: 'g2', position: 1, name: 'Edge' }] }
      if (call.table === 'incidents') return { data: [{ id: 'i1', title: 'Delayed webhooks', status: 'identified', impact: 'minor' }] }
      if (call.table === 'maintenances') return { data: [
        { id: 'm1', title: 'Upgrade', status: 'scheduled', scheduled_start: '2999-01-01T00:00:00Z', scheduled_end: '2999-01-01T01:00:00Z' },
        { id: 'm2', title: 'Missed', status: 'scheduled', scheduled_start: '2000-01-01T00:00:00Z', scheduled_end: '2000-01-01T01:00:00Z' },
      ] }
      return {}
    })
    const summary = await getProjectStatus(userCtx(db), PROJECT)
    expect(summary.status).toBe('partial_outage')
    expect(summary.headline).toBe('Partial outage')
    expect(summary.components.map((component) => component.slug)).toEqual(['api', 'webhooks', 'cdn'])
    expect(summary.active_incidents[0]?.url).toMatch(/\/status\/quillbase\/status\/incidents\/i1$/)
    expect(summary.maintenances.map((maintenance) => maintenance.id)).toEqual(['m1'])
  })
})

describe('getOverview', () => {
  function overviewDb() {
    return fakeDb((call) => {
      if (call.op === 'rpc') {
        if (call.table === 'get_project_metrics') return { data: emptyMetrics }
        if (call.table === 'get_project_uptime') return { data: { timezone: 'Europe/Madrid', days: 90, components: [] } }
        if (call.table === 'get_project_latency') return { data: { checks: 0, p95_ms: null, buckets: [], monitors: [], components: [] } }
      }
      if (call.table === 'status_page_subscribers') return { count: 3 }
      if (call.table === 'monitors') return { data: [
        { id: 'm1', name: 'API health', type: 'http', state: 'up', enabled: true, paused_reason: null, interval_seconds: 30, monitor_components: [] },
        { id: 'm2', name: 'Webhook delivery', type: 'http', state: 'degraded', enabled: true, paused_reason: null, interval_seconds: 60, monitor_components: [] },
        { id: 'm3', name: 'Old check', type: 'tcp', state: 'paused', enabled: false, paused_reason: null, interval_seconds: 60, monitor_components: [] },
      ] }
      return { data: [] }
    })
  }

  it('hides subscriber counts and the setup checklist from non-admins', async () => {
    state.role = 'responder'
    const { db, calls } = overviewDb()
    const overview = await getOverview(userCtx(db), PROJECT, { now: new Date('2026-10-09T12:00:00Z') })
    expect(calls.some((call) => call.table === 'status_page_subscribers')).toBe(false)
    expect(overview.status_page.subscribers).toBeNull()
    expect(overview.checklist).toBeNull()
    expect(overview.kpis.monitors).toMatchObject({ total: 2, passing: 1, paused: 1, min_interval_seconds: 30 })
    expect(overview.kpis.monitors.failing.map((monitor) => monitor.name)).toEqual(['Webhook delivery'])
  })

  it('shows admins the counts and the checklist while the page is new', async () => {
    const { db } = overviewDb()
    const overview = await getOverview(userCtx(db), PROJECT, { now: new Date('2026-10-09T12:00:00Z') })
    expect(overview.status_page.subscribers).toEqual({ email: 3, slack: 3, webhook: 3 })
    expect(overview.checklist?.items.map((item) => [item.key, item.done])).toEqual([
      ['components', false],
      ['monitors', true],
      ['alerts', false],
      ['share', true],
    ])
    const hidden = await getOverview(userCtx(overviewDb().db), PROJECT, { now: new Date('2026-10-09T12:00:00Z'), checklistHidden: true })
    expect(hidden.checklist).toBeNull()
  })
})
