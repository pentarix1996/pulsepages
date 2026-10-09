import 'server-only'
import { hasRole, ORG_ROLE_LABELS, type OrgRole } from '@shared/domain.ts'
import type { DomainContext } from './context'
import { DomainError, forbidden, fromDatabaseError, notFound } from './errors'
import type { OrganizationRow, ProjectRow } from './types'

export type OrganizationSummary = Pick<OrganizationRow, 'id' | 'name' | 'slug' | 'plan' | 'personal' | 'sso_domain' | 'require_2fa'>

export interface ProjectAccess {
  project: ProjectRow
  organization: OrganizationSummary
  role: OrgRole
}

export interface OrganizationAccess {
  organization: OrganizationRow
  role: OrgRole
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(value: string): boolean {
  return UUID.test(value)
}

const ORG_COLUMNS = 'id, name, slug, plan, personal, sso_domain, require_2fa'

function denied(ctx: DomainContext, minRole: OrgRole): DomainError {
  if (ctx.actor.type === 'api_key') {
    return forbidden(minRole === 'owner' ? 'API keys cannot do this. Use the dashboard.' : 'This API key is read-only. Create a key with the write scope.')
  }
  return forbidden(`You need the ${ORG_ROLE_LABELS[minRole].toLowerCase()} role or higher to do this.`)
}

/** Role an API key gets inside its organization: write → admin, read → viewer. Owner actions are dashboard-only. */
function apiKeyRole(ctx: DomainContext): OrgRole {
  return ctx.actor.type === 'api_key' && ctx.actor.scopes.includes('write') ? 'admin' : 'viewer'
}

async function userRole(ctx: DomainContext, organizationId: string): Promise<OrgRole | null> {
  if (ctx.actor.type !== 'user') return null
  const { data, error } = await ctx.db
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', ctx.actor.id)
    .maybeSingle()
  if (error) throw fromDatabaseError(error)
  return (data?.role as OrgRole | undefined) ?? null
}

/**
 * Loads a project the actor can access with at least `minRole`. `ref` is an id, or a slug for API keys
 * (slugs are unique inside an organization). Missing and forbidden projects both read as "not found".
 */
export async function requireProject(ctx: DomainContext, ref: string, minRole: OrgRole = 'viewer'): Promise<ProjectAccess> {
  const select = `*, organization:organizations(${ORG_COLUMNS})`
  let query = ctx.db.from('projects').select(select)

  if (ctx.actor.type === 'api_key') {
    query = query.eq('organization_id', ctx.actor.organizationId)
    query = isUuid(ref) ? query.eq('id', ref) : query.eq('slug', ref.toLowerCase())
    if (ctx.actor.projectId) query = query.eq('id', ctx.actor.projectId)
  } else {
    if (!isUuid(ref)) throw notFound('Status page')
    query = query.eq('id', ref)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw fromDatabaseError(error, 'Status page')
  if (!data) throw notFound('Status page')
  const { organization, ...project } = data as ProjectRow & { organization: OrganizationSummary }

  let role: OrgRole | null
  if (ctx.actor.type === 'user') role = await userRole(ctx, project.organization_id)
  else if (ctx.actor.type === 'api_key') role = apiKeyRole(ctx)
  else role = 'owner'

  if (!role) throw notFound('Status page')
  if (!hasRole(role, minRole)) throw denied(ctx, minRole)
  return { project: project as ProjectRow, organization, role }
}

/** Loads an organization by id or slug with at least `minRole`. API keys only reach their own organization. */
export async function requireOrganization(ctx: DomainContext, ref: string, minRole: OrgRole = 'viewer'): Promise<OrganizationAccess> {
  let query = ctx.db.from('organizations').select('*')
  query = isUuid(ref) ? query.eq('id', ref) : query.ilike('slug', ref)
  if (ctx.actor.type === 'api_key') query = query.eq('id', ctx.actor.organizationId)
  const { data, error } = await query.maybeSingle()
  if (error) throw fromDatabaseError(error, 'Organization')
  if (!data) throw notFound('Organization')
  const organization = data as OrganizationRow

  let role: OrgRole | null
  if (ctx.actor.type === 'user') role = await userRole(ctx, organization.id)
  else if (ctx.actor.type === 'api_key') role = apiKeyRole(ctx)
  else role = 'owner'

  if (!role) throw notFound('Organization')
  if (!hasRole(role, minRole)) throw denied(ctx, minRole)
  return { organization, role }
}

/** Organizations the user belongs to, with their role. */
export async function listMemberships(ctx: DomainContext): Promise<Array<{ organization: OrganizationRow; role: OrgRole }>> {
  if (ctx.actor.type !== 'user') return []
  const { data, error } = await ctx.db
    .from('organization_members')
    .select('role, organization:organizations(*)')
    .eq('user_id', ctx.actor.id)
  if (error) throw fromDatabaseError(error)
  return ((data ?? []) as unknown as Array<{ role: OrgRole; organization: OrganizationRow }>)
    .filter((row) => row.organization)
    .sort((a, b) => Number(b.organization.personal) - Number(a.organization.personal) || a.organization.name.localeCompare(b.organization.name))
}

/** Projects visible to the actor (an API key sees its organization, or its single project). */
export async function listAccessibleProjects(ctx: DomainContext, organizationId?: string): Promise<ProjectRow[]> {
  let query = ctx.db.from('projects').select('*').order('created_at', { ascending: true })
  if (ctx.actor.type === 'api_key') {
    query = query.eq('organization_id', ctx.actor.organizationId)
    if (ctx.actor.projectId) query = query.eq('id', ctx.actor.projectId)
  } else if (organizationId) {
    query = query.eq('organization_id', organizationId)
  }
  const { data, error } = await query
  if (error) throw fromDatabaseError(error)
  return (data ?? []) as ProjectRow[]
}

export function requireWriteScope(ctx: DomainContext): void {
  if (ctx.actor.type === 'api_key' && !ctx.actor.scopes.includes('write')) {
    throw forbidden('This API key is read-only. Create a key with the write scope.')
  }
}

/** Organization-level actions (members, billing, API keys) are not available to API keys. */
export function requireDashboardUser(ctx: DomainContext): asserts ctx is DomainContext & { actor: { type: 'user'; id: string; email: string | null; label: string } } {
  if (ctx.actor.type !== 'user') throw forbidden('This action is only available in the dashboard.')
}
