import 'server-only'
import type { NextRequest } from 'next/server'
import { sha256Hex } from '@shared/crypto.ts'
import { apiRateLimitPerMinute, planAllows } from '@shared/plans.ts'
import { apiKeyContext, newRequestId, type AuthenticatedKey, type DomainContext } from '@/lib/domain/context'
import { DomainError, forbidden, unauthorized } from '@/lib/domain/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { errorJson, toDomainError } from './responses'

type Params = Record<string, string | string[]>

export interface ApiHandlerArgs<P extends Params> {
  request: NextRequest
  url: URL
  params: P
  ctx: DomainContext
}

/** `{ data }` for single resources, `{ data, next_cursor }` for lists; a Response passes through untouched. */
export type ApiResult = Response | { data: unknown; status?: number; nextCursor?: string | null } | void

export interface ApiHandlerOptions {
  /** `read` for GET endpoints; `write` for everything that changes data. */
  scope: 'read' | 'write'
  /** POST endpoints honour Idempotency-Key. */
  idempotent?: boolean
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Request-Id',
  'Access-Control-Expose-Headers': 'X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, Idempotent-Replayed',
  'Access-Control-Max-Age': '86400',
}

export function apiOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const TOKEN_PATTERN = /^(upv_live_|pp_live_)[A-Za-z0-9]{16,128}$/

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1]!.trim() : null
}

export async function authenticateApiKey(request: Request): Promise<AuthenticatedKey> {
  const token = bearerToken(request)
  if (!token) throw new DomainError('unauthorized', 'Send your API key as "Authorization: Bearer upv_live_…".')
  if (!TOKEN_PATTERN.test(token)) throw unauthorized('The API key is not valid.')
  const { data, error } = await createAdminClient().rpc('authenticate_api_key', { p_token_hash: await sha256Hex(token) })
  if (error) throw new DomainError('unavailable', 'Authentication is temporarily unavailable.')
  if (!data) throw unauthorized('The API key is not valid, expired or was revoked.')
  const key = data as AuthenticatedKey
  if (!planAllows(key.plan, 'api')) throw new DomainError('plan_required', 'API access requires the Pro plan. Upgrade the organization to use this key.')
  return key
}

interface RateLimitState {
  allowed: boolean
  limit: number
  remaining: number
  reset_at: string
}

export async function consumeRateLimit(bucket: string, limit: number, windowSeconds = 60): Promise<{ state: RateLimitState; headers: Record<string, string> }> {
  const { data, error } = await createAdminClient().rpc('consume_rate_limit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds })
  // Fail open on infrastructure errors: rate limiting protects us, it must not take the API down.
  const state: RateLimitState = error || !data ? { allowed: true, limit, remaining: limit, reset_at: new Date(Date.now() + windowSeconds * 1000).toISOString() } : (data as RateLimitState)
  const resetSeconds = Math.ceil(new Date(state.reset_at).getTime() / 1000)
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(state.limit),
    'X-RateLimit-Remaining': String(state.remaining),
    'X-RateLimit-Reset': String(resetSeconds),
  }
  if (!state.allowed) headers['Retry-After'] = String(Math.max(1, resetSeconds - Math.floor(Date.now() / 1000)))
  return { state, headers }
}

interface StoredIdempotency {
  request_hash: string
  status_code: number | null
  response: unknown
}

async function beginIdempotency(keyId: string, idempotencyKey: string, requestHash: string): Promise<{ replay?: { status: number; body: unknown } } | null> {
  const admin = createAdminClient()
  const insert = await admin.from('api_idempotency_keys').insert({ api_key_id: keyId, idempotency_key: idempotencyKey, request_hash: requestHash })
  if (!insert.error) return null
  if (insert.error.code !== '23505') throw new DomainError('unavailable', 'Could not record the idempotency key. Try again.')
  const { data } = await admin
    .from('api_idempotency_keys')
    .select('request_hash, status_code, response')
    .eq('api_key_id', keyId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle<StoredIdempotency>()
  if (!data) return null
  if (data.request_hash !== requestHash) {
    throw new DomainError('idempotency_conflict', 'This Idempotency-Key was already used with a different request.')
  }
  if (data.status_code === null) throw new DomainError('conflict', 'A request with this Idempotency-Key is still being processed.')
  return { replay: { status: data.status_code, body: data.response } }
}

async function finishIdempotency(keyId: string, idempotencyKey: string, status: number, body: unknown): Promise<void> {
  const admin = createAdminClient()
  if (status >= 500) {
    await admin.from('api_idempotency_keys').delete().eq('api_key_id', keyId).eq('idempotency_key', idempotencyKey)
    return
  }
  await admin.from('api_idempotency_keys').update({ status_code: status, response: body }).eq('api_key_id', keyId).eq('idempotency_key', idempotencyKey)
}

/**
 * Route handler for the public API (`/api/v1/**`): bearer API key, plan check, per-key rate limit, write scope,
 * Idempotency-Key replay, `{ data }` envelope and `{ error, code }` errors with X-Request-Id.
 */
export function apiHandler<P extends Params = Record<string, never>>(options: ApiHandlerOptions, handler: (args: ApiHandlerArgs<P>) => Promise<ApiResult>) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const requestId = request.headers.get('x-request-id')?.slice(0, 64) || newRequestId()
    const headers: Record<string, string> = { ...CORS_HEADERS, 'X-Request-Id': requestId, 'Cache-Control': 'no-store' }
    let idempotency: { keyId: string; key: string } | null = null
    try {
      const key = await authenticateApiKey(request)
      const rate = await consumeRateLimit(`api_key:${key.id}`, apiRateLimitPerMinute(key.plan))
      Object.assign(headers, rate.headers)
      if (!rate.state.allowed) throw new DomainError('rate_limited', 'Too many requests. Slow down and retry after the time in Retry-After.')
      if (options.scope === 'write' && !key.scopes.includes('write')) throw forbidden('This API key is read-only. Create a key with the write scope.')

      const url = new URL(request.url)
      let bodyText = ''
      const idempotencyKey = options.idempotent ? request.headers.get('idempotency-key')?.trim() : null
      if (idempotencyKey) {
        if (idempotencyKey.length > 255) throw new DomainError('invalid_request', 'Idempotency-Key must be at most 255 characters.')
        bodyText = await request.clone().text()
        const requestHash = await sha256Hex(`${request.method} ${url.pathname}\n${bodyText}`)
        const started = await beginIdempotency(key.id, idempotencyKey, requestHash)
        if (started?.replay) {
          return Response.json(started.replay.body, { status: started.replay.status, headers: { ...headers, 'Idempotent-Replayed': 'true' } })
        }
        idempotency = { keyId: key.id, key: idempotencyKey }
      }

      const ctx = apiKeyContext(key, request, requestId)
      const params = (await context.params) ?? ({} as P)
      const result = await handler({ request, url, params, ctx })

      let response: Response
      let storedBody: unknown = null
      if (result instanceof Response) {
        response = result
        for (const [name, value] of Object.entries(headers)) if (!response.headers.has(name)) response.headers.set(name, value)
      } else if (!result) {
        response = new Response(null, { status: 204, headers })
      } else {
        storedBody = 'nextCursor' in result ? { data: result.data, next_cursor: result.nextCursor ?? null } : { data: result.data }
        response = Response.json(storedBody, { status: result.status ?? 200, headers })
      }
      if (idempotency) await finishIdempotency(idempotency.keyId, idempotency.key, response.status, storedBody)
      return response
    } catch (error) {
      const domain = toDomainError(error)
      if (idempotency) {
        await finishIdempotency(idempotency.keyId, idempotency.key, domain.status, { error: domain.message, code: domain.code }).catch(() => undefined)
      }
      return errorJson(domain, headers, requestId)
    }
  }
}

/**
 * Handler for token-authenticated endpoints without an API key (heartbeats, inbound alerts): rate limited per
 * token, CORS open, same error envelope.
 */
export function tokenHandler<P extends Params>(options: { bucket: (params: P) => string; limitPerMinute: number }, handler: (args: { request: NextRequest; url: URL; params: P; requestId: string }) => Promise<ApiResult>) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const requestId = newRequestId()
    const headers: Record<string, string> = { ...CORS_HEADERS, 'X-Request-Id': requestId, 'Cache-Control': 'no-store' }
    try {
      const params = await context.params
      const rate = await consumeRateLimit(options.bucket(params), options.limitPerMinute)
      Object.assign(headers, rate.headers)
      if (!rate.state.allowed) throw new DomainError('rate_limited', 'Too many requests for this token.')
      const result = await handler({ request, url: new URL(request.url), params, requestId })
      if (result instanceof Response) return result
      if (!result) return new Response(null, { status: 204, headers })
      return Response.json({ data: result.data }, { status: result.status ?? 200, headers })
    } catch (error) {
      return errorJson(error, headers, requestId)
    }
  }
}
