import 'server-only'
import type { OrgRole } from '@shared/domain.ts'
import { requireDashboardUser, requireOrganization, type OrganizationAccess } from './access'
import { audit } from './audit'
import type { DomainContext } from './context'
import { conflict, forbidden, fromDatabaseError, notFound } from './errors'
import { leaveOrganization } from './organizations'
import { assignableRoles, canManageMember, memberDisplayName, type MemberResource } from './schemas/organizations'

export { assignableRoles, canManageMember, memberDisplayName }

interface MemberListRow {
  user_id: string
  name: string | null
  username: string | null
  email: string | null
  role: OrgRole
  joined_at: string
  mfa_enabled: boolean | null
}

async function fetchMembers(ctx: DomainContext & { actor: { type: 'user'; id: string } }, organizationId: string): Promise<MemberResource[]> {
  const { data, error } = await ctx.db.rpc('organization_member_list', { p_organization_id: organizationId })
  if (error) throw fromDatabaseError(error, 'Organization')
  return ((data ?? []) as MemberListRow[]).map((row) => ({ ...row, is_you: row.user_id === ctx.actor.id }))
}

export async function listMembers(ctx: DomainContext, organizationId: string): Promise<{ access: OrganizationAccess; members: MemberResource[] }> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'viewer')
  return { access, members: await fetchMembers(ctx, access.organization.id) }
}

/** Database errors from the membership guard, in words. The last-owner rule is enforced by the database. */
function membershipError(error: { code?: string; message?: string }): Error {
  if (/at least one owner/i.test(error.message ?? '')) return conflict('An organization needs at least one owner. Make someone else an owner first.')
  if (/owner role/i.test(error.message ?? '')) return forbidden('Only owners can grant or remove the owner role.')
  return fromDatabaseError(error, 'Member')
}

function findMember(members: MemberResource[], userId: string): MemberResource {
  const member = members.find((item) => item.user_id === userId)
  if (!member) throw notFound('Member')
  return member
}

export async function changeMemberRole(ctx: DomainContext, organizationId: string, userId: string, role: OrgRole): Promise<MemberResource> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'admin')
  const target = findMember(await fetchMembers(ctx, access.organization.id), userId)
  if (!canManageMember(access.role, target.role) || !assignableRoles(access.role).includes(role)) {
    throw forbidden('Only owners can grant or remove the owner role.')
  }
  if (target.role === role) return target

  const { data, error } = await ctx.db
    .from('organization_members')
    .update({ role })
    .eq('organization_id', access.organization.id)
    .eq('user_id', target.user_id)
    .select('user_id')
  if (error) throw membershipError(error)
  if (((data ?? []) as unknown[]).length === 0) throw forbidden('You do not have permission to do this.')
  await audit(ctx, {
    organizationId: access.organization.id,
    action: 'member.role_changed',
    targetType: 'user',
    targetId: target.user_id,
    metadata: { name: memberDisplayName(target), email: target.email, from: target.role, to: role },
  })
  return { ...target, role }
}

export async function removeMember(ctx: DomainContext, organizationId: string, userId: string): Promise<void> {
  requireDashboardUser(ctx)
  if (userId === ctx.actor.id) return leaveOrganization(ctx, organizationId)
  const access = await requireOrganization(ctx, organizationId, 'admin')
  const target = findMember(await fetchMembers(ctx, access.organization.id), userId)
  if (!canManageMember(access.role, target.role)) throw forbidden('Only owners can remove owners.')
  const { data, error } = await ctx.db
    .from('organization_members')
    .delete()
    .eq('organization_id', access.organization.id)
    .eq('user_id', target.user_id)
    .select('user_id')
  if (error) throw membershipError(error)
  if (((data ?? []) as unknown[]).length === 0) throw forbidden('You do not have permission to do this.')
  await audit(ctx, {
    organizationId: access.organization.id,
    action: 'member.removed',
    targetType: 'user',
    targetId: target.user_id,
    metadata: { name: memberDisplayName(target), email: target.email, role: target.role },
  })
}
