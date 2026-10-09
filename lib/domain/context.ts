import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKeyScope } from '@shared/domain.ts'
import type { Plan } from '@shared/plans.ts'
import { createActorClient, createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { unauthorized } from './errors'

export type Actor =
  | { type: 'user'; id: string; email: string | null; label: string }
  | {
      type: 'api_key'
      id: string
      label: string
      organizationId: string
      organizationSlug: string
      projectId: string | null
      scopes: ApiKeyScope[]
      plan: Plan
      prefix: string | null
    }
  | { type: 'system'; id: null; label: string }

export interface DomainContext {
  actor: Actor
  /**
   * Database client for this actor. Users: cookie-bound client (RLS by membership). API keys: service role with the
   * x-upvane-actor header (same guards as users; authorization is checked in lib/domain/access.ts). System: admin.
   */
  db: SupabaseClient
  /** Fully privileged client. Only after an explicit authorization check, for writes no policy allows. */
  admin: () => SupabaseClient
  ip: string | null
  requestId: string
}

let adminSingleton: SupabaseClient | null = null
function admin(): SupabaseClient {
  adminSingleton ??= createAdminClient()
  return adminSingleton
}

export function requestIp(request?: Request | null): string | null {
  if (!request) return null
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim() || null
  return request.headers.get('x-real-ip')
}

export function newRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

/** Context for a signed-in dashboard user (Server Components, internal route handlers). */
export async function userContext(request?: Request | null): Promise<DomainContext> {
  const db = await createServerClient()
  const { data, error } = await db.auth.getUser()
  if (error || !data.user) throw unauthorized()
  const user = data.user
  const name = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : null
  return {
    actor: { type: 'user', id: user.id, email: user.email ?? null, label: name || user.email || 'A team member' },
    db,
    admin,
    ip: requestIp(request),
    requestId: newRequestId(),
  }
}

/** Same as userContext but returns null instead of throwing when nobody is signed in. */
export async function optionalUserContext(request?: Request | null): Promise<DomainContext | null> {
  try {
    return await userContext(request)
  } catch {
    return null
  }
}

export interface AuthenticatedKey {
  id: string
  name: string
  organization_id: string
  organization_slug: string
  project_id: string | null
  scopes: ApiKeyScope[]
  plan: Plan
  prefix: string | null
}

export function apiKeyContext(key: AuthenticatedKey, request: Request | null, requestId = newRequestId()): DomainContext {
  return {
    actor: {
      type: 'api_key',
      id: key.id,
      label: `API key ${key.name}`,
      organizationId: key.organization_id,
      organizationSlug: key.organization_slug,
      projectId: key.project_id,
      scopes: key.scopes,
      plan: key.plan,
      prefix: key.prefix,
    },
    db: createActorClient(`api_key:${key.id}`),
    admin,
    ip: requestIp(request),
    requestId,
  }
}

export function systemContext(label = 'Upvane'): DomainContext {
  return { actor: { type: 'system', id: null, label }, db: admin(), admin, ip: null, requestId: newRequestId() }
}

/** Label recorded on incident and maintenance updates made by API keys (users are recorded by id). */
export function actorLabel(ctx: DomainContext): string | null {
  return ctx.actor.type === 'user' ? null : ctx.actor.label
}

export function actorUserId(ctx: DomainContext): string | null {
  return ctx.actor.type === 'user' ? ctx.actor.id : null
}
