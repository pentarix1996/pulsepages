// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasRole, type OrgRole } from '@shared/domain.ts'
import { DomainError, forbidden } from '@/lib/domain/errors'
import { apiKeyCtx, fakeDb, userCtx, type QueryCall, type QueryResult } from '../projects/fake-db'

const state = vi.hoisted(() => ({ role: 'owner' as string }))

vi.mock('@/lib/domain/audit', () => ({ audit: vi.fn(async () => undefined) }))
vi.mock('@/lib/domain/cache', () => ({ invalidateStatusPage: vi.fn(), statusPageTag: (org: string, slug: string) => `status-page:${org}/${slug}` }))
vi.mock('@/lib/domain/access', () => ({
  isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
  requireProject: vi.fn(async (_ctx: unknown, _ref: string, minRole: OrgRole = 'viewer') => {
    if (!hasRole(state.role, minRole)) throw forbidden(`You need the ${minRole} role or higher to do this.`)
    return {
      project: { id: PROJECT, slug: 'status', custom_domain: null, custom_domain_status: 'none' },
      organization: { id: 'org-1', name: 'Quillbase', slug: 'quillbase', plan: 'business', personal: false },
      role: state.role,
    }
  }),
}))

const { audit } = await import('@/lib/domain/audit')
const { invalidateStatusPage } = await import('@/lib/domain/cache')
const {
  acknowledgeIncident,
  createIncident,
  deleteIncident,
  DEFAULT_INCIDENT_MESSAGES,
  legacyComponentChanges,
  planIncidentCreate,
  postIncidentUpdate,
  publishIncident,
  resolveComponentMap,
  toActor,
} = await import('@/lib/domain/incidents')

const PROJECT = '44444444-4444-4444-8444-444444444444'
const INCIDENT = '55555555-5555-4555-8555-555555555555'
const API = 'c1111111-1111-4111-8111-111111111111'
const DB = 'c2222222-2222-4222-8222-222222222222'

const INDEX = [
  { id: API, slug: 'api', name: 'API', status: 'operational' as const, position: 0, group_id: null },
  { id: DB, slug: 'database', name: 'Database', status: 'operational' as const, position: 1, group_id: null },
]

function incidentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INCIDENT,
    project_id: PROJECT,
    title: 'Elevated API errors',
    description: null,
    status: 'investigating',
    impact: 'major',
    severity: null,
    component_ids: [],
    detected_at: '2026-10-09T10:00:00Z',
    acknowledged_at: null,
    acknowledged_by: null,
    published_at: '2026-10-09T10:00:00Z',
    resolved_at: null,
    created_by: 'user-1',
    source: 'manual',
    source_monitor_id: null,
    deleted_at: null,
    created_at: '2026-10-09T10:00:00Z',
    updated_at: '2026-10-09T10:00:00Z',
    ...overrides,
  }
}

/** Answers the reads every incident write performs; `rpc` decides what each RPC returns. */
function respond(row: Record<string, unknown>, rpc: (call: QueryCall) => QueryResult | undefined = () => ({ data: row })) {
  return (call: QueryCall): QueryResult | undefined => {
    if (call.op === 'rpc') return rpc(call)
    if (call.table === 'incidents') return { data: row }
    if (call.table === 'components') return { data: INDEX }
    if (call.table === 'profiles') return { data: [{ id: 'user-1', name: 'Ana Ortiz', username: 'ana' }] }
    return { data: [] }
  }
}

beforeEach(() => {
  state.role = 'owner'
  vi.mocked(audit).mockClear()
  vi.mocked(invalidateStatusPage).mockClear()
})

describe('planIncidentCreate', () => {
  it('needs a title from the request or the template', () => {
    expect(() => planIncidentCreate({} as never, null, INDEX, 'user')).toThrow(DomainError)
  })

  it('uses the default message for the status when none is written, and no message for drafts', () => {
    const plan = planIncidentCreate({ title: '  Slow checkout  ' } as never, null, INDEX, 'user')
    expect(plan).toMatchObject({ title: 'Slow checkout', status: 'investigating', impact: 'minor', message: DEFAULT_INCIDENT_MESSAGES.investigating, source: 'manual', notifySubscribers: true })
    expect(planIncidentCreate({ title: 'x', status: 'draft' } as never, null, INDEX, 'user').message).toBeNull()
  })

  it('resolves components by key and maps v0 severity to impact and component status', () => {
    const plan = planIncidentCreate({ title: 'x', severity: 'critical', component_ids: ['api'], components: { database: 'degraded' } } as never, null, INDEX, 'api_key')
    expect(plan.impact).toBe('critical')
    expect(plan.components).toEqual({ [API]: 'major_outage', [DB]: 'degraded' })
    expect(plan.source).toBe('api')
  })

  it('rejects unknown components with a field error', () => {
    try {
      planIncidentCreate({ title: 'x', components: { billing: 'degraded' } } as never, null, INDEX, 'user')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError)
      expect((error as DomainError).details).toEqual([{ path: 'components', message: 'Unknown component billing.' }])
    }
  })

  it('fills from a template and skips components deleted since', () => {
    const template = { id: 't1', title: 'Database maintenance overrun', message: 'Taking longer than planned.', impact: 'minor' as const, status: 'identified' as const, component_statuses: { database: 'degraded' as const, gone: 'major_outage' as const } }
    const plan = planIncidentCreate({ impact: 'major' } as never, template, INDEX, 'user')
    expect(plan).toMatchObject({ title: 'Database maintenance overrun', impact: 'major', status: 'identified', message: 'Taking longer than planned.', source: 'template', components: { [DB]: 'degraded' } })
  })
})

describe('component helpers', () => {
  it('resolveComponentMap accepts ids and keys', () => {
    expect(resolveComponentMap(INDEX, { [API]: 'operational', DATABASE: null })).toEqual({ [API]: 'operational', [DB]: null })
  })

  it('legacyComponentChanges removes unlisted components and keeps existing statuses when asked', () => {
    const current = [
      { component_id: API, status: 'degraded' as const },
      { component_id: 'gone', status: 'major_outage' as const },
    ]
    expect(legacyComponentChanges(current, [API, DB], 'partial_outage', true)).toEqual({ gone: null, [DB]: 'partial_outage' })
    expect(legacyComponentChanges(current, [API], 'partial_outage', false)).toEqual({ gone: null, [API]: 'partial_outage' })
  })

  it('toActor labels people, API keys and Upvane', () => {
    const names = new Map([['user-1', 'Ana Ortiz']])
    expect(toActor('user-1', null, names)).toEqual({ type: 'user', label: 'Ana Ortiz' })
    expect(toActor('user-2', null, names)).toEqual({ type: 'user', label: 'A team member' })
    expect(toActor(null, 'API key CI', names)).toEqual({ type: 'api_key', label: 'API key CI' })
    expect(toActor(null, 'Datadog', names)).toEqual({ type: 'system', label: 'Datadog' })
    expect(toActor(null, null, names)).toEqual({ type: 'system', label: 'Upvane' })
  })
})

describe('createIncident', () => {
  it('is forbidden for viewers', async () => {
    state.role = 'viewer'
    const { db, calls } = fakeDb(respond(incidentRow()))
    await expect(createIncident(userCtx(db), PROJECT, { title: 'x' } as never)).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toHaveLength(0)
  })

  it('lets responders open an incident, audits it and refreshes the status page', async () => {
    state.role = 'responder'
    const row = incidentRow()
    const { db, calls } = fakeDb(respond(row))
    const incident = await createIncident(userCtx(db), PROJECT, { title: 'Elevated API errors', impact: 'major', components: { api: 'partial_outage' } } as never)
    const rpc = calls.find((call) => call.op === 'rpc' && call.table === 'create_incident')
    expect(rpc?.payload).toMatchObject({ p_project_id: PROJECT, p_title: 'Elevated API errors', p_impact: 'major', p_components: { [API]: 'partial_outage' }, p_source: 'manual', p_actor_label: null })
    expect(vi.mocked(audit).mock.calls[0]![1]).toMatchObject({ action: 'incident.created', targetId: INCIDENT })
    expect(invalidateStatusPage).toHaveBeenCalledWith('quillbase', 'status')
    expect(incident.url).toBe('http://localhost:3000/status/quillbase/status/incidents/' + INCIDENT)
  })

  it('does not refresh the status page for drafts and passes the API key label', async () => {
    const row = incidentRow({ status: 'draft', published_at: null })
    const { db, calls } = fakeDb(respond(row))
    const incident = await createIncident(apiKeyCtx(db), PROJECT, { title: 'Draft', status: 'draft' } as never)
    expect(calls.find((call) => call.table === 'create_incident')?.payload).toMatchObject({ p_message: null, p_source: 'api', p_actor_label: 'API key CI' })
    expect(invalidateStatusPage).not.toHaveBeenCalled()
    expect(incident.url).toBeNull()
  })
})

describe('updates and publishing', () => {
  it('refuses a public update on a draft without a status', async () => {
    const { db } = fakeDb(respond(incidentRow({ status: 'draft' })))
    await expect(postIncidentUpdate(userCtx(db), PROJECT, INCIDENT, { message: 'hi', visibility: 'public', notify_subscribers: true } as never)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('internal notes never change status or components and do not touch the status page', async () => {
    const update = { id: 'u1', incident_id: INCIDENT, kind: 'note', visibility: 'internal', status: null, message: 'Paged DB team', component_statuses: {}, notify_subscribers: false, created_by: 'user-1', actor_label: null, created_at: '2026-10-09T10:05:00Z' }
    const { db, calls } = fakeDb(respond(incidentRow(), () => ({ data: update })))
    const resource = await postIncidentUpdate(userCtx(db), PROJECT, INCIDENT, { message: 'Paged DB team', visibility: 'internal', status: 'resolved', components: { api: 'operational' }, notify_subscribers: true } as never)
    expect(calls.find((call) => call.table === 'post_incident_update')?.payload).toMatchObject({ p_status: null, p_components: null, p_notify_subscribers: false, p_visibility: 'internal' })
    expect(vi.mocked(audit).mock.calls[0]![1]).toMatchObject({ action: 'incident.note_added' })
    expect(invalidateStatusPage).not.toHaveBeenCalled()
    expect(resource.actor).toEqual({ type: 'user', label: 'Ana Ortiz' })
  })

  it('records a resolve as incident.resolved', async () => {
    const update = { id: 'u2', incident_id: INCIDENT, kind: 'update', visibility: 'public', status: 'resolved', message: 'Fixed', component_statuses: {}, notify_subscribers: true, created_by: 'user-1', actor_label: null, created_at: '2026-10-09T11:00:00Z' }
    const { db } = fakeDb(respond(incidentRow(), () => ({ data: update })))
    await postIncidentUpdate(userCtx(db), PROJECT, INCIDENT, { message: 'Fixed', visibility: 'public', status: 'resolved', notify_subscribers: true } as never)
    expect(vi.mocked(audit).mock.calls[0]![1]).toMatchObject({ action: 'incident.resolved', metadata: { previous_status: 'investigating', status: 'resolved' } })
    expect(invalidateStatusPage).toHaveBeenCalledOnce()
  })

  it('publishing works only on drafts and uses the default message', async () => {
    const live = fakeDb(respond(incidentRow()))
    await expect(publishIncident(userCtx(live.db), PROJECT, INCIDENT, { status: 'identified', notify_subscribers: true } as never)).rejects.toMatchObject({ code: 'conflict' })

    const update = { id: 'u3', incident_id: INCIDENT, kind: 'update', visibility: 'public', status: 'identified', message: '', component_statuses: {}, notify_subscribers: true, created_by: 'user-1', actor_label: null, created_at: '2026-10-09T11:00:00Z' }
    const draft = fakeDb(respond(incidentRow({ status: 'draft' }), (call) => (call.table === 'post_incident_update' ? { data: update } : undefined)))
    await publishIncident(userCtx(draft.db), PROJECT, INCIDENT, { status: 'identified', message: '  ', notify_subscribers: true } as never)
    expect(draft.calls.find((call) => call.table === 'post_incident_update')?.payload).toMatchObject({ p_status: 'identified', p_message: DEFAULT_INCIDENT_MESSAGES.identified, p_visibility: 'public' })
    expect(vi.mocked(audit).mock.calls[0]![1]).toMatchObject({ action: 'incident.published' })
  })
})

describe('acknowledge and delete', () => {
  it('acknowledging twice only records it once', async () => {
    const { db, calls } = fakeDb(respond(incidentRow({ acknowledged_at: '2026-10-09T10:02:00Z', acknowledged_by: 'user-1' })))
    const incident = await acknowledgeIncident(userCtx(db), PROJECT, INCIDENT)
    expect(calls.some((call) => call.table === 'acknowledge_incident')).toBe(false)
    expect(audit).not.toHaveBeenCalled()
    expect(incident.acknowledged_by).toEqual({ type: 'user', label: 'Ana Ortiz' })
  })

  it('needs an admin to delete', async () => {
    state.role = 'responder'
    const { db, calls } = fakeDb(respond(incidentRow()))
    await expect(deleteIncident(userCtx(db), PROJECT, INCIDENT)).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toHaveLength(0)

    state.role = 'admin'
    const admin = fakeDb(respond(incidentRow(), () => ({ data: null })))
    await deleteIncident(userCtx(admin.db), PROJECT, INCIDENT)
    expect(admin.calls.find((call) => call.table === 'delete_incident')?.payload).toEqual({ p_incident_id: INCIDENT, p_actor_label: null })
    expect(vi.mocked(audit).mock.calls[0]![1]).toMatchObject({ action: 'incident.deleted' })
    expect(invalidateStatusPage).toHaveBeenCalledOnce()
  })

  it('treats malformed ids as not found without querying', async () => {
    const { db, calls } = fakeDb(respond(incidentRow()))
    await expect(deleteIncident(userCtx(db), PROJECT, 'not-a-uuid')).rejects.toMatchObject({ code: 'not_found' })
    expect(calls).toHaveLength(0)
  })
})
