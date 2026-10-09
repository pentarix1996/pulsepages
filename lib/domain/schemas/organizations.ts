// Organizations, members, invitations, billing and the audit log (settings pages, /api/app/**).
import { z } from 'zod'
import { hasRole, ORG_ROLES, type OrgRole } from '@shared/domain.ts'
import { PLANS } from '@shared/plans.ts'
import { email, nullable, timestamp, uuid } from './common'

export const orgRole = z.enum(ORG_ROLES)

/** Roles `actorRole` may give: admins manage up to admin, owners manage everyone (spec §1). Isomorphic. */
export function assignableRoles(actorRole: OrgRole | null | undefined): OrgRole[] {
  if (actorRole === 'owner') return [...ORG_ROLES]
  if (actorRole === 'admin') return ORG_ROLES.filter((role) => role !== 'owner')
  return []
}

/** Whether `actorRole` may change or remove someone who has `targetRole`. Only owners touch owners. */
export function canManageMember(actorRole: OrgRole | null | undefined, targetRole: OrgRole): boolean {
  if (!hasRole(actorRole, 'admin')) return false
  return targetRole !== 'owner' || actorRole === 'owner'
}

/** Organization URL key: /status/{slug}/{page}. Same rule as the database trigger. */
export const organizationSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Use 2-63 lowercase letters, numbers or hyphens.')

export const organizationName = z.string().trim().min(2, 'Use at least 2 characters.').max(80, 'Use at most 80 characters.')

/** Email domain sent to the identity provider (acme.com). */
export const ssoDomain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().max(253).regex(/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain such as acme.com.'))

export const organizationCreateInput = z.object({
  name: organizationName,
  slug: nullable(organizationSlug).optional(),
})
export type OrganizationCreateInput = z.infer<typeof organizationCreateInput>

export const organizationUpdateInput = z.object({
  name: organizationName.optional(),
  slug: organizationSlug.optional(),
  sso_domain: nullable(ssoDomain).optional(),
  require_2fa: z.boolean().optional(),
})
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateInput>

export const organizationDeleteInput = z.object({
  /** The organization slug, typed by the person to confirm. */
  confirm: z.string().trim().min(1, 'Type the organization URL to confirm.'),
})

export const memberRoleInput = z.object({
  role: orgRole,
})
export type MemberRoleInput = z.infer<typeof memberRoleInput>

export const invitationCreateInput = z.object({
  organization_id: uuid,
  email,
  role: orgRole.default('responder'),
})
export type InvitationCreateInput = z.infer<typeof invitationCreateInput>

export const BILLING_INTERVALS = ['monthly', 'yearly'] as const
export const planChangeInput = z.object({
  organization_id: uuid,
  plan: z.enum(PLANS),
  interval: z.enum(BILLING_INTERVALS).default('monthly'),
})
export type PlanChangeInput = z.infer<typeof planChangeInput>

export const AUDIT_ACTOR_TYPES = ['user', 'api_key', 'system'] as const
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number]

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-10-09.')

/** Audit log filters as they appear in the URL (?action=member.&actor=user&from=2026-10-01&to=2026-10-09). */
export const auditLogFilters = z.object({
  action: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9_.]*$/i, 'Use letters, numbers, dots and underscores.')
    .optional()
    .transform((value) => value || undefined),
  actor: z.enum(AUDIT_ACTOR_TYPES).optional().catch(undefined),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
})
export type AuditLogFilters = z.infer<typeof auditLogFilters>

// ---------------------------------------------------------------- responses
export const organizationResource = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  plan: z.enum(PLANS),
  personal: z.boolean(),
  sso_domain: z.string().nullable(),
  require_2fa: z.boolean(),
  created_at: timestamp,
  /** The caller's role in this organization. */
  role: orgRole,
})
export type OrganizationResource = z.infer<typeof organizationResource>

export const memberResource = z.object({
  user_id: uuid,
  name: z.string().nullable(),
  username: z.string().nullable(),
  /** Visible to admins and owners (and on your own row). */
  email: z.string().nullable(),
  role: orgRole,
  joined_at: timestamp,
  /** Null when the caller cannot see it. */
  mfa_enabled: z.boolean().nullable(),
  is_you: z.boolean(),
})
export type MemberResource = z.infer<typeof memberResource>

export function memberDisplayName(member: Pick<MemberResource, 'name' | 'username' | 'email'>): string {
  return member.name?.trim() || member.username || member.email || 'Team member'
}

export const INVITATION_STATUSES = ['pending', 'expired', 'accepted', 'revoked'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

export const invitationResource = z.object({
  id: uuid,
  organization_id: uuid,
  email: z.string(),
  role: orgRole,
  status: z.enum(INVITATION_STATUSES),
  invited_by: z.object({ id: uuid, name: z.string() }).nullable(),
  created_at: timestamp,
  expires_at: timestamp,
})
export type InvitationResource = z.infer<typeof invitationResource>

export const invitationDelivery = z.object({
  sent: z.boolean(),
  /** Only when the email could not be sent: the link to share by hand. */
  invite_url: z.string().optional(),
  reason: z.enum(['not_configured', 'failed']).optional(),
})
export type InvitationDelivery = z.infer<typeof invitationDelivery>

export const planUsage = z.object({
  status_pages: z.number().int(),
  monitors_total: z.number().int(),
  monitors_active: z.number().int(),
  monitors_paused_by_plan: z.number().int(),
  monitors_interval_below: z.object({ '60': z.number().int(), '180': z.number().int() }),
  monitors_regions_above: z.object({ '1': z.number().int(), '3': z.number().int() }),
  members: z.number().int(),
  pending_invitations: z.number().int(),
  largest_page: z.object({ project_id: uuid, name: z.string(), subscribers: z.number().int() }).nullable(),
  custom_domains: z.number().int(),
  private_pages: z.number().int(),
  paging_channels: z.number().int(),
  api_keys_active: z.number().int(),
})
export type PlanUsage = z.infer<typeof planUsage>

export const auditEntryResource = z.object({
  id: z.string(),
  created_at: timestamp,
  actor: z.object({ type: z.enum(AUDIT_ACTOR_TYPES), id: z.string().nullable(), label: z.string() }),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  target_label: z.string().nullable(),
  project_id: uuid.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
})
export type AuditEntryResource = z.infer<typeof auditEntryResource>
