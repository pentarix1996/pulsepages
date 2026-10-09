// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasRole, type OrgRole } from '@shared/domain.ts'
import { DomainError, forbidden } from '@/lib/domain/errors'
import { apiKeyCtx, fakeDb, filterValue, userCtx, type QueryCall, type QueryResult } from './fake-db'

const state = vi.hoisted(() => ({ role: 'owner' as string, orgRole: 'owner' as string, project: null as Record<string, unknown> | null }))

vi.mock('@/lib/domain/audit', () => ({ audit: vi.fn(async () => undefined) }))
vi.mock('@/lib/domain/cache', () => ({ invalidateStatusPage: vi.fn(), statusPageTag: (org: string, slug: string) => `status-page:${org}/${slug}` }))
vi.mock('@/lib/domain/access', () => ({
  isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
  requireWriteScope: (ctx: { actor: { type: string; scopes?: string[] } }) => {
    if (ctx.actor.type === 'api_key' && !ctx.actor.scopes?.includes('write')) throw forbidden('This API key is read-only. Create a key with the write scope.')
  },
  requireProject: vi.fn(async (_ctx: unknown, _ref: string, minRole: OrgRole = 'viewer') => {
    if (!hasRole(state.role, minRole)) throw forbidden(`You need the ${minRole} role or higher to do this.`)
    return { project: state.project, organization: { id: 'org-1', name: 'Quillbase', slug: 'quillbase', plan: 'business', personal: false, sso_domain: null, require_2fa: false }, role: state.role }
  }),
  requireOrganization: vi.fn(async (_ctx: unknown, ref: string, minRole: OrgRole = 'viewer') => {
    if (!hasRole(state.orgRole, minRole)) throw forbidden(`You need the ${minRole} role or higher to do this.`)
    return { organization: { id: ref, name: 'Quillbase', slug: 'quillbase', plan: 'business', personal: false }, role: state.orgRole }
  }),
  listMemberships: vi.fn(async () => []),
}))

const { audit } = await import('@/lib/domain/audit')
const { invalidateStatusPage } = await import('@/lib/domain/cache')
const access = await import('@/lib/domain/access')
const { createProject, deleteProject, toProjectResource, updateProject } = await import('@/lib/domain/projects')

const ORG = '33333333-3333-4333-8333-333333333333'
const PROJECT = '44444444-4444-4444-8444-444444444444'

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT,
    organization_id: ORG,
    user_id: 'user-1',
    name: 'Quillbase status',
    slug: 'status',
    description: null,
    created_at: '2026-06-11T14:15:21Z',
    updated_at: '2026-10-09T14:15:21Z',
    visibility: 'public',
    brand_color: null,
    logo_url: null,
    theme_default: 'system',
    timezone: 'Europe/Madrid',
    hide_powered_by: false,
    custom_domain: null,
    custom_domain_status: 'none',
    custom_domain_verified_at: null,
    custom_domain_error: null,
    allowed_ips: [],
    support_url: null,
    auto_postmortem: true,
    auto_draft_incidents: true,
    uptime_weights: { major_outage: 1, partial_outage: 0.3, degraded: 0 },
    ...overrides,
  }
}

/** Answers project reads with `row` and slug listings with `slugs`. */
function projectDb(options: { slugs?: string[]; row?: Record<string, unknown>; insertError?: QueryResult['error']; onWrite?: (call: QueryCall) => QueryResult | undefined } = {}) {
  return fakeDb((call) => {
    if (call.table !== 'projects') return {}
    if (call.op === 'select' && call.columns === 'slug') return { data: (options.slugs ?? []).map((slug) => ({ slug })) }
    if (call.op === 'insert') return options.onWrite?.(call) ?? { error: options.insertError ?? null }
    if (call.op === 'update' || call.op === 'delete') return options.onWrite?.(call) ?? { data: [{ id: PROJECT }] }
    if (call.op === 'select') {
      const inserted = [...calls].reverse().find((item) => item.op === 'insert')
      const id = (inserted?.payload as { id?: string } | undefined)?.id ?? PROJECT
      return { data: projectRow({ id, ...(options.row ?? {}) }) }
    }
    return {}
  })
}
let calls: QueryCall[] = []

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'owner'
  state.orgRole = 'owner'
  state.project = projectRow()
})

describe('createProject', () => {
  it('requires an organization for dashboard users', async () => {
    const { db } = projectDb()
    await expect(createProject(userCtx(db), { name: 'Docs' })).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('requires the admin role in that organization', async () => {
    state.orgRole = 'responder'
    const fake = projectDb()
    calls = fake.calls
    await expect(createProject(userCtx(fake.db), { organization_id: ORG, name: 'Docs' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(access.requireOrganization).toHaveBeenCalledWith(expect.anything(), ORG, 'admin')
    expect(fake.calls.some((call) => call.op === 'insert')).toBe(false)
  })

  it('generates a slug that is free in the organization and audits the creation', async () => {
    const fake = projectDb({ slugs: ['quillbase-status', 'status'] })
    calls = fake.calls
    const project = await createProject(userCtx(fake.db), { organization_id: ORG, name: 'Quillbase Status', timezone: 'Europe/Madrid' })
    const insert = fake.calls.find((call) => call.op === 'insert')!
    expect(insert.payload).toMatchObject({ organization_id: ORG, name: 'Quillbase Status', slug: 'quillbase-status-2', timezone: 'Europe/Madrid', user_id: 'user-1' })
    expect(project.id).toBe((insert.payload as { id: string }).id)
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'project.created', organizationId: ORG }))
  })

  it('refuses a slug already used in the organization', async () => {
    const fake = projectDb({ slugs: ['docs'] })
    calls = fake.calls
    await expect(createProject(userCtx(fake.db), { organization_id: ORG, name: 'Docs', slug: 'docs' })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('retries with the next slug when another page took it meanwhile', async () => {
    let attempts = 0
    const fake = projectDb({
      onWrite: () => {
        attempts += 1
        return attempts === 1 ? { error: { code: '23505', message: 'duplicate key value violates unique constraint "projects_org_slug_key"', details: 'Key (organization_id, slug)' } } : { error: null }
      },
    })
    calls = fake.calls
    await createProject(userCtx(fake.db), { organization_id: ORG, name: 'Docs' })
    const slugs = fake.calls.filter((call) => call.op === 'insert').map((call) => (call.payload as { slug: string }).slug)
    expect(slugs).toEqual(['docs', 'docs-2'])
  })

  it('maps plan limits from the database to 402 errors', async () => {
    const fake = projectDb({ insertError: { code: 'P0001', message: 'Your free plan allows 1 status page. Upgrade to add more.' } })
    calls = fake.calls
    const error = await createProject(userCtx(fake.db), { organization_id: ORG, name: 'Docs' }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'plan_limit', status: 402, message: 'Your free plan allows 1 status page. Upgrade to add more.' })
  })

  it('only lets organization-wide API keys create pages, in their own organization', async () => {
    const fake = projectDb()
    calls = fake.calls
    await expect(createProject(apiKeyCtx(fake.db, { projectId: PROJECT }), { name: 'Docs' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createProject(apiKeyCtx(fake.db, { scopes: ['read'] }), { name: 'Docs' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createProject(apiKeyCtx(fake.db, { organizationId: 'org-1' }), { name: 'Docs', organization_id: ORG })).rejects.toMatchObject({ code: 'not_found' })
    const project = await createProject(apiKeyCtx(fake.db, { organizationId: ORG }), { name: 'Docs' })
    const insert = fake.calls.find((call) => call.op === 'insert')!
    expect(insert.payload).toMatchObject({ organization_id: ORG, slug: 'docs' })
    expect(insert.payload).not.toHaveProperty('user_id')
    expect(project.status_page_url).toMatch(/\/status\/quillbase\/status$/)
  })
})

describe('updateProject', () => {
  it('needs the admin role and writes nothing otherwise', async () => {
    state.role = 'responder'
    const fake = projectDb()
    calls = fake.calls
    await expect(updateProject(userCtx(fake.db), PROJECT, { name: 'New name' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(access.requireProject).toHaveBeenCalledWith(expect.anything(), PROJECT, 'admin')
    expect(fake.calls).toHaveLength(0)
  })

  it('writes only what changed, with full uptime weights, and invalidates the old and new slug', async () => {
    const fake = projectDb({ slugs: ['status'], row: { slug: 'status-eu' } })
    calls = fake.calls
    await updateProject(userCtx(fake.db), PROJECT, { slug: 'status-eu', name: 'Quillbase status', uptime_weights: { partial_outage: 0.5, degraded: 0.1 }, allowed_ips: ['10.0.0.0/8'] })
    const update = fake.calls.find((call) => call.op === 'update')!
    expect(update.payload).toEqual({ slug: 'status-eu', uptime_weights: { major_outage: 1, partial_outage: 0.5, degraded: 0.1 }, allowed_ips: ['10.0.0.0/8'] })
    expect(filterValue(update, 'eq', 'id')).toBe(PROJECT)
    expect(invalidateStatusPage).toHaveBeenCalledWith('quillbase', 'status')
    expect(invalidateStatusPage).toHaveBeenCalledWith('quillbase', 'status-eu')
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'project.updated', metadata: expect.objectContaining({ slug: { from: 'status', to: 'status-eu' } }) }))
  })

  it('leaves the domain alone when it did not change, and sends null to remove it', async () => {
    state.project = projectRow({ custom_domain: 'status.example.com', custom_domain_status: 'verified' })
    const unchanged = projectDb()
    calls = unchanged.calls
    await updateProject(userCtx(unchanged.db), PROJECT, { custom_domain: 'status.example.com' })
    expect(unchanged.calls.some((call) => call.op === 'update')).toBe(false)

    const removed = projectDb()
    calls = removed.calls
    await updateProject(userCtx(removed.db), PROJECT, { custom_domain: null })
    expect(removed.calls.find((call) => call.op === 'update')?.payload).toEqual({ custom_domain: null })
  })

  it('reports plan gates raised by the database', async () => {
    const fake = projectDb({ onWrite: (call) => (call.op === 'update' ? { error: { code: 'P0001', message: 'Private status pages require the Business plan.' } } : undefined) })
    calls = fake.calls
    await expect(updateProject(userCtx(fake.db), PROJECT, { visibility: 'private' })).rejects.toMatchObject({ code: 'plan_limit', message: 'Private status pages require the Business plan.' })
    expect(invalidateStatusPage).not.toHaveBeenCalled()
  })

  it('refuses a slug used by another page of the organization', async () => {
    const fake = projectDb({ slugs: ['status', 'docs'] })
    calls = fake.calls
    await expect(updateProject(userCtx(fake.db), PROJECT, { slug: 'docs' })).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('deleteProject', () => {
  it('needs the admin role', async () => {
    state.role = 'viewer'
    const fake = projectDb()
    await expect(deleteProject(userCtx(fake.db), PROJECT)).rejects.toMatchObject({ code: 'forbidden' })
    expect(fake.calls).toHaveLength(0)
  })

  it('deletes, audits without the (deleted) project reference and expires the cached page', async () => {
    const fake = projectDb()
    calls = fake.calls
    await deleteProject(userCtx(fake.db), PROJECT)
    expect(fake.calls.find((call) => call.op === 'delete')).toBeTruthy()
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'project.deleted', projectId: null, targetId: PROJECT }))
    expect(invalidateStatusPage).toHaveBeenCalledWith('quillbase', 'status')
  })
})

describe('toProjectResource', () => {
  it('uses the custom domain for the public URL only once it is verified', () => {
    expect(toProjectResource(projectRow({ custom_domain: 'status.example.com', custom_domain_status: 'pending' }) as never, 'quillbase').status_page_url).toMatch(/\/status\/quillbase\/status$/)
    expect(toProjectResource(projectRow({ custom_domain: 'status.example.com', custom_domain_status: 'verified' }) as never, 'quillbase').status_page_url).toBe('https://status.example.com')
  })

  it('fills uptime weight defaults', () => {
    expect(toProjectResource(projectRow({ uptime_weights: {} }) as never, 'quillbase').uptime_weights).toEqual({ major_outage: 1, partial_outage: 0.3, degraded: 0 })
  })
})
