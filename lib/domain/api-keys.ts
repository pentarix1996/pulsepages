import 'server-only'
import { generateToken, sha256Hex } from '@shared/crypto.ts'
import type { ApiKeyScope } from '@shared/domain.ts'
import { planAllows } from '@shared/plans.ts'
import { requireDashboardUser, requireOrganization } from './access'
import { audit } from './audit'
import type { DomainContext } from './context'
import { DomainError, conflict, forbidden, fromDatabaseError, invalid, notFound, unwrap } from './errors'
import type { ApiKeyAccess, ApiKeyCreateInput, ApiKeyResource, ApiKeyStatus, MeResource, RotationGrace } from './schemas/api-keys'
import type { ApiKeyRow, OrganizationRow } from './types'

export const API_KEY_TOKEN_PREFIX = 'upv_live_'
/** Characters of the key kept in clear (`upv_live_` + 4), enough to recognise it in lists and logs. */
export const API_KEY_VISIBLE_PREFIX_LENGTH = 13
export const ROTATION_GRACE_SECONDS: Record<RotationGrace, number> = { '1h': 3_600, '24h': 86_400, '7d': 604_800 }

const COLUMNS = 'id, organization_id, project_id, user_id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_by, created_at'

export function scopesFor(access: ApiKeyAccess): ApiKeyScope[] {
  return access === 'write' ? ['read', 'write'] : ['read']
}

export function apiKeyStatus(row: Pick<ApiKeyRow, 'revoked_at' | 'expires_at'>, now: Date = new Date()): ApiKeyStatus {
  if (row.revoked_at) return 'revoked'
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'active'
}

/** A new key: the secret is returned once; only its SHA-256 and the visible prefix are stored. */
export async function generateApiKeySecret(): Promise<{ token: string; tokenHash: string; prefix: string }> {
  const token = generateToken(API_KEY_TOKEN_PREFIX)
  return { token, tokenHash: await sha256Hex(token), prefix: token.slice(0, API_KEY_VISIBLE_PREFIX_LENGTH) }
}

export function toApiKeyResource(row: ApiKeyRow, lookups: { projects: Map<string, string>; people: Map<string, string> }, now: Date = new Date()): ApiKeyResource {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    project: row.project_id ? { id: row.project_id, name: lookups.projects.get(row.project_id) ?? 'Deleted status page' } : null,
    created_by: row.created_by ? { id: row.created_by, name: lookups.people.get(row.created_by) ?? 'Former member' } : null,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    status: apiKeyStatus(row, now),
  }
}

async function lookups(ctx: DomainContext, rows: ApiKeyRow[]): Promise<{ projects: Map<string, string>; people: Map<string, string> }> {
  const projectIds = [...new Set(rows.map((row) => row.project_id).filter((id): id is string => Boolean(id)))]
  const peopleIds = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))]
  const [projects, people] = await Promise.all([
    projectIds.length > 0 ? ctx.db.from('projects').select('id, name').in('id', projectIds) : Promise.resolve({ data: [] }),
    peopleIds.length > 0 ? ctx.db.from('profiles').select('id, name, username').in('id', peopleIds) : Promise.resolve({ data: [] }),
  ])
  return {
    projects: new Map(((projects.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])),
    people: new Map(((people.data ?? []) as Array<{ id: string; name: string | null; username: string | null }>).map((row) => [row.id, row.name?.trim() || row.username || 'Team member'])),
  }
}

function requireApiPlan(organization: Pick<OrganizationRow, 'plan'>): void {
  if (!planAllows(organization.plan, 'api')) {
    throw new DomainError('plan_required', 'API keys are part of the Pro and Business plans. Upgrade the organization to create one.')
  }
}

/** Keys of an organization, newest first (admins and owners). */
export async function listApiKeys(ctx: DomainContext, organizationId: string): Promise<ApiKeyResource[]> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'admin')
  const rows = unwrap(await ctx.db.from('api_keys').select(COLUMNS).eq('organization_id', access.organization.id).order('created_at', { ascending: false }).limit(500)) as ApiKeyRow[]
  const maps = await lookups(ctx, rows)
  return rows.map((row) => toApiKeyResource(row, maps))
}

async function insertKey(
  ctx: DomainContext & { actor: { type: 'user'; id: string } },
  values: { organizationId: string; projectId: string | null; name: string; scopes: ApiKeyScope[]; expiresAt: string | null },
): Promise<{ row: ApiKeyRow; token: string }> {
  const secret = await generateApiKeySecret()
  // api_keys has no insert policy: keys are only created here, after the admin and plan checks.
  const { data, error } = await ctx
    .admin()
    .from('api_keys')
    .insert({
      organization_id: values.organizationId,
      project_id: values.projectId,
      user_id: null,
      name: values.name,
      token_hash: secret.tokenHash,
      prefix: secret.prefix,
      scopes: values.scopes,
      expires_at: values.expiresAt,
      created_by: ctx.actor.id,
    })
    .select(COLUMNS)
    .single()
  if (error) throw fromDatabaseError(error, 'API key')
  return { row: data as ApiKeyRow, token: secret.token }
}

export async function createApiKey(ctx: DomainContext, input: ApiKeyCreateInput): Promise<{ key: ApiKeyResource; token: string }> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, input.organization_id, 'admin')
  requireApiPlan(access.organization)
  const projectId = input.project_id ?? null
  let projectName: string | null = null
  if (projectId) {
    // C-1: a key can only be limited to a status page of its own organization.
    const { data } = await ctx.db.from('projects').select('id, name').eq('id', projectId).eq('organization_id', access.organization.id).maybeSingle()
    if (!data) throw invalid('Choose a status page that belongs to this organization.')
    projectName = (data as { name: string }).name
  }
  const expiresAt = input.expires_in_days ? new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString() : null
  const { row, token } = await insertKey(ctx, { organizationId: access.organization.id, projectId, name: input.name, scopes: scopesFor(input.access), expiresAt })
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId,
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: row.id,
    metadata: { name: row.name, prefix: row.prefix, scopes: row.scopes, project_id: projectId, expires_at: expiresAt },
  })
  return {
    key: toApiKeyResource(row, { projects: new Map(projectId && projectName ? [[projectId, projectName]] : []), people: new Map([[ctx.actor.id, ctx.actor.label]]) }),
    token,
  }
}

async function loadKey(ctx: DomainContext, keyId: string): Promise<ApiKeyRow> {
  if (!/^[0-9a-f-]{36}$/i.test(keyId)) throw notFound('API key')
  const { data, error } = await ctx.db.from('api_keys').select(COLUMNS).eq('id', keyId).maybeSingle()
  if (error) throw fromDatabaseError(error, 'API key')
  if (!data) throw notFound('API key')
  return data as ApiKeyRow
}

/**
 * Rotation (B-7): a new key with the same name, access, scope and lifetime, while the old one keeps working for a
 * grace period so deploys can switch over without downtime.
 */
export async function rotateApiKey(ctx: DomainContext, keyId: string, grace: RotationGrace): Promise<{ key: ApiKeyResource; token: string; previous: ApiKeyResource }> {
  requireDashboardUser(ctx)
  const current = await loadKey(ctx, keyId)
  const access = await requireOrganization(ctx, current.organization_id, 'admin')
  requireApiPlan(access.organization)
  if (apiKeyStatus(current) !== 'active') throw conflict('This key is no longer active. Create a new key instead.')

  const now = Date.now()
  const lifetime = current.expires_at ? new Date(current.expires_at).getTime() - new Date(current.created_at).getTime() : null
  const expiresAt = lifetime && lifetime > 0 ? new Date(now + lifetime).toISOString() : null
  const { row, token } = await insertKey(ctx, { organizationId: current.organization_id, projectId: current.project_id, name: current.name, scopes: current.scopes, expiresAt })

  const graceEnd = now + ROTATION_GRACE_SECONDS[grace] * 1000
  const previousExpiry = current.expires_at && new Date(current.expires_at).getTime() < graceEnd ? current.expires_at : new Date(graceEnd).toISOString()
  const { data: updated, error } = await ctx.db.from('api_keys').update({ expires_at: previousExpiry }).eq('id', current.id).select(COLUMNS).maybeSingle()
  if (error || !updated) {
    // Never leave two keys without telling anyone: undo the new key.
    await ctx.admin().from('api_keys').delete().eq('id', row.id)
    throw error ? fromDatabaseError(error, 'API key') : forbidden('You do not have permission to do this.')
  }
  await audit(ctx, {
    organizationId: current.organization_id,
    projectId: current.project_id,
    action: 'api_key.rotated',
    targetType: 'api_key',
    targetId: current.id,
    metadata: { name: current.name, previous_prefix: current.prefix, new_key_id: row.id, new_prefix: row.prefix, grace, previous_expires_at: previousExpiry },
  })
  const maps = await lookups(ctx, [row, updated as ApiKeyRow])
  return { key: toApiKeyResource(row, maps), token, previous: toApiKeyResource(updated as ApiKeyRow, maps) }
}

export async function revokeApiKey(ctx: DomainContext, keyId: string): Promise<void> {
  requireDashboardUser(ctx)
  const current = await loadKey(ctx, keyId)
  const access = await requireOrganization(ctx, current.organization_id, 'admin')
  if (current.revoked_at) return
  const { data, error } = await ctx.db.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', current.id).select('id')
  if (error) throw fromDatabaseError(error, 'API key')
  if (((data ?? []) as unknown[]).length === 0) throw forbidden('You do not have permission to do this.')
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: current.project_id,
    action: 'api_key.revoked',
    targetType: 'api_key',
    targetId: current.id,
    metadata: { name: current.name, prefix: current.prefix },
  })
}

/** GET /api/v1/me: the calling key and its organization. */
export async function getMe(ctx: DomainContext): Promise<MeResource> {
  if (ctx.actor.type !== 'api_key') throw forbidden('This endpoint describes the API key that calls it.')
  const [key, organization] = await Promise.all([
    ctx.db.from('api_keys').select('id, name, prefix, scopes, project_id').eq('id', ctx.actor.id).maybeSingle(),
    ctx.db.from('organizations').select('id, slug, name, plan').eq('id', ctx.actor.organizationId).maybeSingle(),
  ])
  if (key.error || organization.error) throw fromDatabaseError(key.error ?? organization.error, 'API key')
  if (!key.data || !organization.data) throw notFound('API key')
  const row = key.data as Pick<ApiKeyRow, 'id' | 'name' | 'prefix' | 'scopes' | 'project_id'>
  return {
    key: { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes, project_id: row.project_id },
    organization: organization.data as MeResource['organization'],
  }
}
