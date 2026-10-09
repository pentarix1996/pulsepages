import 'server-only'
// Data access for the public status page. Anonymous reads of public pages go through a cookie-less client with the
// publishable key and are cached for 30 seconds under the page's tag (invalidated by lib/domain/cache.ts). Reads that
// depend on who is asking (private pages) are never cached: members use their session, access links and allow-listed
// networks use the service role after the access check in ./access.ts.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { statusPageTag } from '@/lib/domain/cache'
import { env } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import {
  normalizeHistory,
  normalizeIncident,
  normalizeMaintenance,
  normalizePage,
  type HistoryPayload,
  type IncidentPayload,
  type MaintenancePayload,
  type PageAccessInfo,
  type StatusPagePayload,
} from './types'

export const STATUS_PAGE_REVALIDATE_SECONDS = 30

export class StatusPageLoadError extends Error {
  constructor(
    readonly fn: string,
    readonly cause: { code?: string; message?: string },
  ) {
    super(`Could not load the status page (${fn}): ${cause.message ?? 'unknown error'}`)
    this.name = 'StatusPageLoadError'
  }
}

let anonSingleton: SupabaseClient | null = null
let adminSingleton: SupabaseClient | null = null

/** Cookie-less client with the publishable key: sees public pages only. */
function anonClient(): SupabaseClient {
  anonSingleton ??= createClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return anonSingleton
}

function adminClient(): SupabaseClient {
  adminSingleton ??= createAdminClient()
  return adminSingleton
}

async function call<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new StatusPageLoadError(fn, error)
  return (data ?? null) as T | null
}

/** Service-role RPC. Only for checks (access tokens, allow-lists, subscriptions) and after access was granted. */
export function adminRpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  return call<T>(adminClient(), fn, args)
}

/** RPC with the visitor's Supabase session (organization members on private pages). */
export async function sessionRpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  return call<T>(await createSessionClient(), fn, args)
}

const keyOf = (org: string, slug: string) => [org.toLowerCase(), slug.toLowerCase()]

function cached<T>(name: string, org: string, slug: string, parts: string[], load: () => Promise<T>): Promise<T> {
  return unstable_cache(load, [name, ...keyOf(org, slug), ...parts], { tags: [statusPageTag(org, slug)], revalidate: STATUS_PAGE_REVALIDATE_SECONDS })()
}

function pageArgs(org: string, slug: string) {
  return { p_org_slug: org, p_project_slug: slug }
}

/**
 * The page as an anonymous visitor sees it: the full public page, the private stub or null. Cached; the result is the
 * same for every anonymous visitor, so a shared key is safe.
 */
export async function getPublicPayload(org: string, slug: string): Promise<StatusPagePayload | null> {
  const payload = await cached('status-page', org, slug, [], () => call<StatusPagePayload>(anonClient(), 'get_status_page', pageArgs(org, slug)))
  if (!payload) return null
  return payload.private ? payload : normalizePage(payload)
}

/** Full page with a privileged client (after the access check). */
export async function getPagePayload(via: 'session' | 'admin', org: string, slug: string): Promise<StatusPagePayload | null> {
  const payload = via === 'session' ? await sessionRpc<StatusPagePayload>('get_status_page', pageArgs(org, slug)) : await adminRpc<StatusPagePayload>('get_status_page', pageArgs(org, slug))
  if (!payload) return null
  return payload.private ? payload : normalizePage(payload)
}

export async function getAccessInfo(projectId: string): Promise<PageAccessInfo | null> {
  const info = await adminRpc<PageAccessInfo>('status_page_access_info', { p_project_id: projectId })
  return info ? { ...info, allowed_ips: Array.isArray(info.allowed_ips) ? info.allowed_ips : [] } : null
}

// ------------------------------------------------------------------
// Readers for incident, maintenance and history pages
// ------------------------------------------------------------------
export interface StatusReader {
  incident(id: string): Promise<IncidentPayload | null>
  maintenance(id: string): Promise<MaintenancePayload | null>
  /** Items older than `before` (or the newest), newest first. */
  history(before: string | null, limit: number): Promise<HistoryPayload | null>
  /** The `limit` items right after `after`, newest first. */
  historyNewer(after: string, limit: number): Promise<HistoryPayload | null>
}

type Caller = <T>(fn: string, args: Record<string, unknown>) => Promise<T | null>

function readerWith(callFn: Caller, wrap: <T>(name: string, parts: string[], load: () => Promise<T>) => Promise<T>, org: string, slug: string): StatusReader {
  return {
    async incident(id) {
      const payload = await wrap('status-page-incident', [id], () => callFn<IncidentPayload>('get_status_page_incident', { ...pageArgs(org, slug), p_incident_id: id }))
      return payload ? { ...payload, incident: normalizeIncident(payload.incident) } : null
    },
    async maintenance(id) {
      const payload = await wrap('status-page-maintenance', [id], () => callFn<MaintenancePayload>('get_status_page_maintenance', { ...pageArgs(org, slug), p_maintenance_id: id }))
      return payload ? { ...payload, maintenance: normalizeMaintenance(payload.maintenance) } : null
    },
    async history(before, limit) {
      const payload = await wrap('status-page-history', [before ?? 'latest', String(limit)], () =>
        callFn<HistoryPayload>('get_status_page_history', { ...pageArgs(org, slug), p_before: before, p_limit: limit }),
      )
      return payload ? normalizeHistory(payload) : null
    },
    async historyNewer(after, limit) {
      const payload = await wrap('status-page-history-newer', [after, String(limit)], () =>
        callFn<HistoryPayload>('get_status_page_history_newer', { ...pageArgs(org, slug), p_after: after, p_limit: limit }),
      )
      return payload ? normalizeHistory(payload) : null
    },
  }
}

/** Public pages: anonymous and cached under the page tag. */
export function publicReader(org: string, slug: string): StatusReader {
  const anon: Caller = (fn, args) => call(anonClient(), fn, args)
  return readerWith(anon, (name, parts, load) => cached(name, org, slug, parts, load), org, slug)
}

/** Private pages: per request, never cached. */
export function privateReader(via: 'session' | 'admin', org: string, slug: string): StatusReader {
  const callFn: Caller = via === 'session' ? sessionRpc : adminRpc
  return readerWith(callFn, (_name, _parts, load) => load(), org, slug)
}
