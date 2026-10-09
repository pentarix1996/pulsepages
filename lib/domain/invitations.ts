import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateToken, sha256Hex } from '@shared/crypto.ts'
import type { OrgRole } from '@shared/domain.ts'
import { renderInvitationEmail } from '@shared/emails.ts'
import { PLAN_INFO, planLimit } from '@shared/plans.ts'
import { isInviteToken } from '@/components/auth/safe-next'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDashboardUser, requireOrganization } from './access'
import { audit } from './audit'
import type { DomainContext } from './context'
import { DomainError, conflict, forbidden, fromDatabaseError, notFound, unwrap } from './errors'
import type { InvitationCreateInput, InvitationDelivery, InvitationResource, InvitationStatus } from './schemas/organizations'
import type { InvitationRow, OrganizationRow } from './types'

export const INVITATION_TTL_DAYS = 7
const COLUMNS = 'id, organization_id, email, role, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at'

export function invitationStatus(row: Pick<InvitationRow, 'accepted_at' | 'revoked_at' | 'expires_at'>, now: Date = new Date()): InvitationStatus {
  if (row.accepted_at) return 'accepted'
  if (row.revoked_at) return 'revoked'
  return new Date(row.expires_at).getTime() <= now.getTime() ? 'expired' : 'pending'
}

/** jane.doe@acme.com → j•••@acme.com: enough to recognise the address without revealing it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  if (!domain) return '•••'
  return `${local.slice(0, 1) || '•'}•••@${domain}`
}

export function invitationUrl(token: string): string {
  return `${env.appUrl()}/invite/${token}`
}

async function newInvitationSecret(): Promise<{ token: string; tokenHash: string; expiresAt: string }> {
  const token = generateToken('inv_')
  return { token, tokenHash: await sha256Hex(token), expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString() }
}

async function inviterNames(ctx: DomainContext, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return new Map()
  const { data } = await ctx.db.from('profiles').select('id, name, username').in('id', unique)
  return new Map(((data ?? []) as Array<{ id: string; name: string | null; username: string | null }>).map((row) => [row.id, row.name?.trim() || row.username || 'Team member']))
}

export function toInvitationResource(row: InvitationRow, names: Map<string, string>, now: Date = new Date()): InvitationResource {
  return {
    id: row.id,
    organization_id: row.organization_id,
    email: row.email,
    role: row.role,
    status: invitationStatus(row, now),
    invited_by: row.invited_by ? { id: row.invited_by, name: names.get(row.invited_by) ?? 'Former member' } : null,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }
}

/** Open invitations (pending or expired, not accepted or revoked), newest first. Admins only. */
export async function listInvitations(ctx: DomainContext, organizationId: string): Promise<InvitationResource[]> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'admin')
  const rows = unwrap(
    await ctx.db
      .from('organization_invitations')
      .select(COLUMNS)
      .eq('organization_id', access.organization.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ) as InvitationRow[]
  const names = await inviterNames(ctx, rows.map((row) => row.invited_by))
  return rows.map((row) => toInvitationResource(row, names))
}

async function deliverInvitation(ctx: DomainContext, organization: Pick<OrganizationRow, 'name'>, row: InvitationRow, token: string, tokenHash: string): Promise<InvitationDelivery> {
  const acceptUrl = invitationUrl(token)
  const message = renderInvitationEmail({ organizationName: organization.name, inviterName: ctx.actor.label, role: row.role, acceptUrl, expiresAt: row.expires_at })
  const result = await sendEmail({ to: row.email, subject: message.subject, html: message.html, text: message.text, idempotencyKey: `invitation-${row.id}-${tokenHash.slice(0, 16)}` })
  if (result.ok) return { sent: true }
  if (result.error === 'email_not_configured') return { sent: false, invite_url: acceptUrl, reason: 'not_configured' }
  console.warn('[invitations] email failed', { invitation: row.id, error: result.error })
  return { sent: false, invite_url: acceptUrl, reason: 'failed' }
}

export async function createInvitation(ctx: DomainContext, input: InvitationCreateInput): Promise<{ invitation: InvitationResource; delivery: InvitationDelivery }> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, input.organization_id, 'admin')
  const org = access.organization
  if (input.role === 'owner' && access.role !== 'owner') throw forbidden('Only owners can invite owners.')
  const email = input.email.trim().toLowerCase()

  const { data: memberRows, error: membersError } = await ctx.db.rpc('organization_member_list', { p_organization_id: org.id })
  if (membersError) throw fromDatabaseError(membersError, 'Organization')
  const members = (memberRows ?? []) as Array<{ email: string | null }>
  if (members.some((member) => member.email?.toLowerCase() === email)) throw conflict(`${email} is already a member of ${org.name}.`)

  const open = unwrap(
    await ctx.db.from('organization_invitations').select('id, email, expires_at').eq('organization_id', org.id).is('accepted_at', null).is('revoked_at', null),
  ) as Array<{ id: string; email: string; expires_at: string }>
  const now = Date.now()
  const pending = open.filter((row) => new Date(row.expires_at).getTime() > now)
  if (pending.some((row) => row.email === email)) throw conflict('There is already a pending invitation for this address. Resend it from the list.')

  const limit = planLimit(org.plan, 'members')
  if (limit !== -1 && members.length + pending.length >= limit) {
    throw new DomainError('plan_limit', `Your ${PLAN_INFO[org.plan].name} plan includes ${limit} members, counting pending invitations. Upgrade to invite more people.`)
  }

  // Expired invitations for the same address are replaced by the new one.
  const stale = open.filter((row) => row.email === email).map((row) => row.id)
  if (stale.length > 0) unwrap(await ctx.db.from('organization_invitations').update({ revoked_at: new Date().toISOString() }).in('id', stale))

  const secret = await newInvitationSecret()
  const { data, error } = await ctx.db
    .from('organization_invitations')
    .insert({ organization_id: org.id, email, role: input.role, token_hash: secret.tokenHash, invited_by: ctx.actor.id, expires_at: secret.expiresAt })
    .select(COLUMNS)
    .single()
  if (error) throw fromDatabaseError(error, 'Invitation')
  const row = data as InvitationRow
  const delivery = await deliverInvitation(ctx, org, row, secret.token, secret.tokenHash)
  await audit(ctx, { organizationId: org.id, action: 'invitation.sent', targetType: 'invitation', targetId: row.id, metadata: { email, role: row.role, delivered: delivery.sent } })
  return { invitation: toInvitationResource(row, new Map([[ctx.actor.id, ctx.actor.label]])), delivery }
}

async function loadInvitation(ctx: DomainContext, invitationId: string): Promise<InvitationRow> {
  if (!/^[0-9a-f-]{36}$/i.test(invitationId)) throw notFound('Invitation')
  const { data, error } = await ctx.db.from('organization_invitations').select(COLUMNS).eq('id', invitationId).maybeSingle()
  if (error) throw fromDatabaseError(error, 'Invitation')
  if (!data) throw notFound('Invitation')
  return data as InvitationRow
}

/** Sends the invitation again with a new link and a new expiry; the old link stops working. */
export async function resendInvitation(ctx: DomainContext, invitationId: string): Promise<{ invitation: InvitationResource; delivery: InvitationDelivery }> {
  requireDashboardUser(ctx)
  const current = await loadInvitation(ctx, invitationId)
  const access = await requireOrganization(ctx, current.organization_id, 'admin')
  if (current.accepted_at) throw conflict('This invitation was already accepted.')
  if (current.revoked_at) throw conflict('This invitation was revoked. Send a new one.')
  if (current.role === 'owner' && access.role !== 'owner') throw forbidden('Only owners can invite owners.')

  const secret = await newInvitationSecret()
  const { data, error } = await ctx.db
    .from('organization_invitations')
    .update({ token_hash: secret.tokenHash, expires_at: secret.expiresAt })
    .eq('id', current.id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw fromDatabaseError(error, 'Invitation')
  if (!data) throw forbidden('You do not have permission to do this.')
  const row = data as InvitationRow
  const delivery = await deliverInvitation(ctx, access.organization, row, secret.token, secret.tokenHash)
  await audit(ctx, { organizationId: row.organization_id, action: 'invitation.resent', targetType: 'invitation', targetId: row.id, metadata: { email: row.email, role: row.role, delivered: delivery.sent } })
  return { invitation: toInvitationResource(row, await inviterNames(ctx, [row.invited_by])), delivery }
}

export async function revokeInvitation(ctx: DomainContext, invitationId: string): Promise<void> {
  requireDashboardUser(ctx)
  const current = await loadInvitation(ctx, invitationId)
  const access = await requireOrganization(ctx, current.organization_id, 'admin')
  if (current.accepted_at) throw conflict('This invitation was already accepted. Remove the member instead.')
  if (current.revoked_at) return
  if (current.role === 'owner' && access.role !== 'owner') throw forbidden('Only owners can cancel owner invitations.')
  const { data, error } = await ctx.db.from('organization_invitations').update({ revoked_at: new Date().toISOString() }).eq('id', current.id).select('id')
  if (error) throw fromDatabaseError(error, 'Invitation')
  if (((data ?? []) as unknown[]).length === 0) throw forbidden('You do not have permission to do this.')
  await audit(ctx, { organizationId: current.organization_id, action: 'invitation.revoked', targetType: 'invitation', targetId: current.id, metadata: { email: current.email, role: current.role } })
}

// ------------------------------------------------------------------ accepting

export interface InvitationPreview {
  id: string
  organization: { id: string; name: string; slug: string }
  role: OrgRole
  inviter: string | null
  /** Masked address the invitation was sent to. */
  email_hint: string
  expires_at: string
  status: InvitationStatus
}

/**
 * What a signed-out visitor of /invite/<token> may see: organization, role, inviter and a masked email. Read with the
 * service role because the visitor is not a member yet; the token itself is the credential.
 */
export async function getInvitationPreview(token: string, admin: SupabaseClient = createAdminClient()): Promise<InvitationPreview | null> {
  if (!isInviteToken(token)) return null
  const { data, error } = await admin
    .from('organization_invitations')
    .select('id, email, role, invited_by, expires_at, accepted_at, revoked_at, organization:organizations(id, name, slug)')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle()
  if (error || !data) return null
  const row = data as unknown as Pick<InvitationRow, 'id' | 'email' | 'role' | 'invited_by' | 'expires_at' | 'accepted_at' | 'revoked_at'> & {
    organization: { id: string; name: string; slug: string } | null
  }
  if (!row.organization) return null
  let inviter: string | null = null
  if (row.invited_by) {
    const { data: profile } = await admin.from('profiles').select('name, username').eq('id', row.invited_by).maybeSingle()
    const value = profile as { name: string | null; username: string | null } | null
    inviter = value?.name?.trim() || value?.username || null
  }
  return {
    id: row.id,
    organization: row.organization,
    role: row.role,
    inviter,
    email_hint: maskEmail(row.email),
    expires_at: row.expires_at,
    status: invitationStatus(row),
  }
}

export type AcceptFailure = 'invalid' | 'revoked' | 'used' | 'expired' | 'wrong_email' | 'member_limit'
export type AcceptOutcome =
  | { status: 'accepted' | 'already_member'; organization: { id: string; name: string; slug: string } }
  | { status: AcceptFailure; message: string; preview: InvitationPreview | null }

/** Joins the organization through accept_invitation() and explains every way it can fail. */
export async function acceptInvitation(ctx: DomainContext, token: string): Promise<AcceptOutcome> {
  requireDashboardUser(ctx)
  const preview = await getInvitationPreview(token, ctx.admin())
  if (!preview) {
    return { status: 'invalid', message: "This invitation link isn't valid. Check that you opened the whole link, or ask for a new invitation.", preview: null }
  }
  const askFor = preview.inviter ? `Ask ${preview.inviter} for a new one.` : 'Ask an admin of the organization for a new one.'
  if (preview.status === 'revoked') return { status: 'revoked', message: `This invitation was cancelled or replaced by a newer one. ${askFor}`, preview }

  const { error } = await ctx.db.rpc('accept_invitation', { p_token: token })
  if (!error) return { status: 'accepted', organization: preview.organization }

  const message = error.message ?? ''
  if (/already used/i.test(message)) {
    const { data: membership } = await ctx.db.from('organization_members').select('role').eq('organization_id', preview.organization.id).eq('user_id', ctx.actor.id).maybeSingle()
    if (membership) return { status: 'already_member', organization: preview.organization }
    return { status: 'used', message: `This invitation was already used. ${askFor}`, preview }
  }
  if (/expired/i.test(message)) return { status: 'expired', message: `This invitation expired. ${askFor}`, preview }
  if (/different email/i.test(message)) {
    return {
      status: 'wrong_email',
      message: `This invitation was sent to ${preview.email_hint}, but you are signed in as ${ctx.actor.email ?? 'another account'}. Sign in with the invited address to accept it.`,
      preview,
    }
  }
  if (/member limit/i.test(message)) {
    return { status: 'member_limit', message: `${preview.organization.name} has reached the member limit of its plan. Ask an owner to upgrade, then open this link again.`, preview }
  }
  if (/not valid/i.test(message)) return { status: 'invalid', message: `This invitation is no longer valid. ${askFor}`, preview }
  throw fromDatabaseError(error, 'Invitation')
}
