import 'server-only'
import { statusPageUrl } from '@shared/alerts/message.ts'
import { generateToken, sha256Hex } from '@shared/crypto.ts'
import { planAllows } from '@shared/plans.ts'
import { env } from '@/lib/env'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import { actorUserId, type DomainContext } from './context'
import { DomainError, invalid, notFound, unwrap, unwrapOne } from './errors'
import type { AccessTokenCreated, AccessTokenCreateInput, AccessTokenResource } from './schemas/status-page'
import type { StatusPageAccessTokenRow } from './types'

const TOKEN_COLUMNS = 'id, project_id, name, prefix, created_by, created_at, expires_at, revoked_at, last_used_at'
/** Access link tokens: spat_ + 43 base62 characters (≈256 bits). Only the SHA-256 is stored. */
export const ACCESS_TOKEN_PREFIX = 'spat_'
const PREFIX_LENGTH = ACCESS_TOKEN_PREFIX.length + 6

export function accessTokenStatus(row: Pick<StatusPageAccessTokenRow, 'revoked_at' | 'expires_at'>, now: Date = new Date()): AccessTokenResource['status'] {
  if (row.revoked_at) return 'revoked'
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'active'
}

export function toAccessTokenResource(row: StatusPageAccessTokenRow, now: Date = new Date()): AccessTokenResource {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    status: accessTokenStatus(row, now),
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
  }
}

/** Public URL of the status page, on the custom domain once it is verified. */
export function publicStatusPageUrl(access: { project: Pick<ProjectAccess['project'], 'slug' | 'custom_domain' | 'custom_domain_status'>; organization: { slug: string } }): string {
  return statusPageUrl(
    {
      organization_slug: access.organization.slug,
      slug: access.project.slug,
      custom_domain: access.project.custom_domain_status === 'verified' ? access.project.custom_domain : null,
    },
    { appUrl: env.appUrl() },
  )
}

export function accessLink(pageUrl: string, token: string): string {
  return `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
}

export async function listAccessTokens(ctx: DomainContext, projectRef: string): Promise<AccessTokenResource[]> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const rows = unwrap(await ctx.db.from('status_page_access_tokens').select(TOKEN_COLUMNS).eq('project_id', access.project.id).order('created_at', { ascending: false })) as StatusPageAccessTokenRow[]
  const now = new Date()
  return rows.map((row) => toAccessTokenResource(row, now))
}

/** Creates an access link for a private page. The token is returned once, inside the link. */
export async function createAccessToken(ctx: DomainContext, projectRef: string, input: AccessTokenCreateInput): Promise<AccessTokenCreated> {
  const access = await requireProject(ctx, projectRef, 'admin')
  if (!planAllows(access.organization.plan, 'private_pages')) {
    throw new DomainError('plan_required', 'Access links are part of private status pages, which require the Business plan.')
  }
  if (input.expires_at && new Date(input.expires_at).getTime() <= Date.now()) {
    throw invalid('Choose an expiry date in the future.', [{ path: 'expires_at', message: 'Choose an expiry date in the future.' }])
  }
  const token = generateToken(ACCESS_TOKEN_PREFIX)
  const row = unwrapOne(
    await ctx.db
      .from('status_page_access_tokens')
      .insert({
        project_id: access.project.id,
        name: input.name,
        token_hash: await sha256Hex(token),
        prefix: token.slice(0, PREFIX_LENGTH),
        created_by: actorUserId(ctx),
        expires_at: input.expires_at ?? null,
      })
      .select(TOKEN_COLUMNS)
      .single(),
    'Access link',
  ) as StatusPageAccessTokenRow
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'status_page.access_token_created',
    targetType: 'status_page_access_token',
    targetId: row.id,
    metadata: { name: row.name, prefix: row.prefix, expires_at: row.expires_at },
  })
  return { token: toAccessTokenResource(row), secret: token, url: accessLink(publicStatusPageUrl(access), token) }
}

export async function revokeAccessToken(ctx: DomainContext, projectRef: string, tokenId: string): Promise<AccessTokenResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  if (!isUuid(tokenId)) throw notFound('Access link')
  const current = unwrapOne(
    await ctx.db.from('status_page_access_tokens').select(TOKEN_COLUMNS).eq('id', tokenId).eq('project_id', access.project.id).maybeSingle(),
    'Access link',
  ) as StatusPageAccessTokenRow
  if (current.revoked_at) return toAccessTokenResource(current)
  const row = unwrapOne(
    await ctx.db
      .from('status_page_access_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', current.id)
      .eq('project_id', access.project.id)
      .select(TOKEN_COLUMNS)
      .maybeSingle(),
    'Access link',
  ) as StatusPageAccessTokenRow
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'status_page.access_token_revoked',
    targetType: 'status_page_access_token',
    targetId: row.id,
    metadata: { name: row.name, prefix: row.prefix },
  })
  return toAccessTokenResource(row)
}
