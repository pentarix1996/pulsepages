import 'server-only'
import type { MonitorState } from '@shared/domain.ts'
import { env } from '@/lib/env'
import type { DomainContext } from './context'
import { fromDatabaseError, notFound } from './errors'
import { fnv1a64 } from './inbound/types'

// Heartbeat pings (spec §5): jobs call /api/v1/heartbeat/{token} (success) or …/fail. The token is the secret, so
// there is no API key; record_heartbeat() runs with the admin client and returns null for unknown tokens.

/** Tokens are 36 hex characters (gen_random_bytes(18)); anything else cannot exist and skips the database. */
export const HEARTBEAT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export function heartbeatUrl(token: string): string {
  return `${env.appUrl()}/api/v1/heartbeat/${token}`
}

/** Rate-limit bucket for a secret token that does not store the token itself. */
export function tokenBucket(kind: 'heartbeat' | 'inbound', token: string): string {
  return `${kind}:${fnv1a64(token)}`
}

export interface HeartbeatResult {
  state: MonitorState
}

/** Records a ping. Paused monitors answer { state: 'paused' } and record nothing. */
export async function recordHeartbeat(ctx: DomainContext, token: string, input: { success: boolean; message?: string | null }): Promise<HeartbeatResult> {
  if (!HEARTBEAT_TOKEN_PATTERN.test(token)) throw notFound('Heartbeat')
  const message = input.success ? null : (input.message ?? '').trim().slice(0, 500) || null
  const { data, error } = await ctx.admin().rpc('record_heartbeat', { p_token: token, p_success: input.success, p_message: message })
  if (error) throw fromDatabaseError(error, 'Heartbeat')
  const result = data as { id: string; state: MonitorState } | null
  if (!result) throw notFound('Heartbeat')
  return { state: result.state }
}

/**
 * Failure message of a /fail ping: `?message=` first, then a JSON body `{ "message": "…" }`, then a plain-text body
 * (`curl -d "Backup failed: disk full"`). Returns null when there is none.
 */
export function failureMessageFrom(query: string | null, bodyText: string, contentType: string | null): string | null {
  const fromQuery = query?.trim()
  if (fromQuery) return fromQuery.slice(0, 500)
  const body = bodyText.trim()
  if (!body) return null
  if (/json/i.test(contentType ?? '') || body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const message = (parsed as Record<string, unknown>).message
        return typeof message === 'string' && message.trim() ? message.trim().slice(0, 500) : null
      }
    } catch {
      // Not JSON after all: use the text as typed.
    }
  }
  if (/x-www-form-urlencoded/i.test(contentType ?? '')) {
    const form = new URLSearchParams(body)
    const message = form.get('message')
    if (message?.trim()) return message.trim().slice(0, 500)
  }
  return body.slice(0, 500)
}
