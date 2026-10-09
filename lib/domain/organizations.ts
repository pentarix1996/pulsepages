import 'server-only'
import { hasRole, type OrgRole } from '@shared/domain.ts'
import { PLAN_INFO, planAllows } from '@shared/plans.ts'
import { listMemberships, requireDashboardUser, requireOrganization } from './access'
import { audit } from './audit'
import { invalidateStatusPage } from './cache'
import type { DomainContext } from './context'
import { DomainError, conflict, forbidden, fromDatabaseError, invalid, unwrap } from './errors'
import type { OrganizationCreateInput, OrganizationResource, OrganizationUpdateInput } from './schemas/organizations'
import type { OrganizationRow } from './types'

export function toOrganizationResource(row: OrganizationRow, role: OrgRole): OrganizationResource {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    personal: row.personal,
    sso_domain: row.sso_domain,
    require_2fa: row.require_2fa,
    created_at: row.created_at,
    role,
  }
}

export interface OrganizationScope {
  current: OrganizationResource
  organizations: OrganizationResource[]
}

/**
 * Organization the settings pages act on (cookie contract, see components/panel/settings/OrgSwitcher.tsx):
 * `upv_org` when it is still a membership, else the organization of the last opened status page (`upv_project`),
 * else the first membership (personal workspace first). Null only for users without any membership.
 */
export async function resolveOrganizationScope(ctx: DomainContext, preferred: { organizationId?: string | null; projectId?: string | null }): Promise<OrganizationScope | null> {
  requireDashboardUser(ctx)
  const memberships = await listMemberships(ctx)
  if (memberships.length === 0) return null
  const organizations = memberships.map(({ organization, role }) => toOrganizationResource(organization, role))

  let current = preferred.organizationId ? organizations.find((org) => org.id === preferred.organizationId) : undefined
  if (!current && preferred.projectId && /^[0-9a-f-]{36}$/i.test(preferred.projectId)) {
    const { data } = await ctx.db.from('projects').select('organization_id').eq('id', preferred.projectId).maybeSingle()
    const organizationId = (data as { organization_id: string } | null)?.organization_id
    current = organizations.find((org) => org.id === organizationId)
  }
  return { current: current ?? organizations[0]!, organizations }
}

export async function getOrganization(ctx: DomainContext, organizationId: string): Promise<OrganizationResource> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'viewer')
  return toOrganizationResource(access.organization, access.role)
}

function slugTaken(): DomainError {
  return conflict('That URL is already taken. Choose another one.')
}

export async function createOrganization(ctx: DomainContext, input: OrganizationCreateInput): Promise<OrganizationResource> {
  requireDashboardUser(ctx)
  const { data, error } = await ctx.db.rpc('create_organization', { p_name: input.name, p_slug: input.slug ?? null })
  if (error) {
    if (error.code === '23505') throw slugTaken()
    throw fromDatabaseError(error, 'Organization')
  }
  // create_organization() writes organization.created to the new organization's audit log.
  return toOrganizationResource(data as OrganizationRow, 'owner')
}

async function currentAssuranceLevel(ctx: DomainContext): Promise<string | null> {
  try {
    const { data } = await ctx.db.auth.mfa.getAuthenticatorAssuranceLevel()
    return data?.currentLevel ?? null
  } catch {
    return null
  }
}

async function invalidateOrganizationPages(ctx: DomainContext, organizationId: string, organizationSlugs: string[]): Promise<void> {
  const { data } = await ctx.admin().from('projects').select('slug').eq('organization_id', organizationId)
  for (const project of (data ?? []) as Array<{ slug: string }>) {
    for (const slug of organizationSlugs) invalidateStatusPage(slug, project.slug)
  }
}

export async function updateOrganization(ctx: DomainContext, organizationId: string, input: OrganizationUpdateInput): Promise<OrganizationResource> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'admin')
  const org = access.organization
  const patch: Partial<Pick<OrganizationRow, 'name' | 'slug' | 'sso_domain' | 'require_2fa'>> = {}

  if (input.name !== undefined && input.name !== org.name) patch.name = input.name
  if (input.slug !== undefined && input.slug !== org.slug.toLowerCase()) {
    if (org.personal) throw invalid('The URL of a personal workspace follows your username and cannot be changed.')
    patch.slug = input.slug
  }
  const securityChange =
    (input.sso_domain !== undefined && input.sso_domain !== org.sso_domain) || (input.require_2fa !== undefined && input.require_2fa !== org.require_2fa)
  if (securityChange && !hasRole(access.role, 'owner')) throw forbidden('Only owners can change security settings.')
  if (input.sso_domain !== undefined && input.sso_domain !== org.sso_domain) {
    if (input.sso_domain !== null && !planAllows(org.plan, 'sso')) {
      throw new DomainError('plan_required', `Single sign-on is part of the Business plan. ${PLAN_INFO[org.plan].name} organizations cannot set an SSO domain.`)
    }
    patch.sso_domain = input.sso_domain
  }
  if (input.require_2fa !== undefined && input.require_2fa !== org.require_2fa) {
    if (input.require_2fa && (await currentAssuranceLevel(ctx)) !== 'aal2') {
      throw invalid('Turn on two-factor authentication for your own account first (Settings → Security), then require it for everyone.')
    }
    patch.require_2fa = input.require_2fa
  }
  if (Object.keys(patch).length === 0) return toOrganizationResource(org, access.role)

  const { data, error } = await ctx.db.from('organizations').update(patch).eq('id', org.id).select('*').maybeSingle()
  if (error) {
    if (error.code === '23505') throw slugTaken()
    throw fromDatabaseError(error, 'Organization')
  }
  if (!data) throw forbidden('You do not have permission to do this.')
  const updated = data as OrganizationRow

  const changes: Record<string, unknown> = { changes: Object.keys(patch) }
  if (patch.slug !== undefined) changes.slug = { from: org.slug, to: updated.slug }
  if (patch.sso_domain !== undefined) changes.sso_domain = { from: org.sso_domain, to: updated.sso_domain }
  if (patch.require_2fa !== undefined) changes.require_2fa = updated.require_2fa
  if (patch.name !== undefined) changes.name = { from: org.name, to: updated.name }
  await audit(ctx, { organizationId: org.id, action: 'organization.updated', targetType: 'organization', targetId: org.id, metadata: changes })

  if (patch.slug !== undefined || patch.name !== undefined) await invalidateOrganizationPages(ctx, org.id, [org.slug, updated.slug])
  return toOrganizationResource(updated, access.role)
}

export async function leaveOrganization(ctx: DomainContext, organizationId: string): Promise<void> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'viewer')
  if (access.organization.personal) throw invalid('You cannot leave your personal workspace.')
  const { data, error } = await ctx.db
    .from('organization_members')
    .delete()
    .eq('organization_id', access.organization.id)
    .eq('user_id', ctx.actor.id)
    .select('user_id')
  if (error) {
    if (/at least one owner/i.test(error.message ?? '')) {
      throw conflict('You are the only owner. Make someone else an owner before you leave, or delete the organization.')
    }
    throw fromDatabaseError(error, 'Membership')
  }
  if (((data ?? []) as unknown[]).length === 0) throw forbidden('You do not have permission to do this.')
  await audit(ctx, { organizationId: access.organization.id, action: 'member.left', targetType: 'user', targetId: ctx.actor.id, metadata: { role: access.role } })
}

/** Deletes a team organization with its status pages. The audit log goes with it (it belongs to the organization). */
export async function deleteOrganization(ctx: DomainContext, organizationId: string, confirm: string): Promise<void> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'owner')
  const org = access.organization
  if (org.personal) throw invalid('Personal workspaces cannot be deleted.')
  if (confirm.trim().toLowerCase() !== org.slug.toLowerCase()) throw invalid(`Type ${org.slug} to confirm.`)

  const projects = unwrap(await ctx.db.from('projects').select('slug').eq('organization_id', org.id)) as Array<{ slug: string }>
  const deleted = unwrap(await ctx.db.from('organizations').delete().eq('id', org.id).select('id')) as Array<{ id: string }>
  if (deleted.length === 0) throw forbidden('You do not have permission to do this.')
  for (const project of projects) invalidateStatusPage(org.slug, project.slug)
  console.info('[organizations] deleted', { organization: org.id, slug: org.slug, by: ctx.actor.id, request: ctx.requestId, status_pages: projects.length })
}
