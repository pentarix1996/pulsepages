// Service-role client for PostgREST. The Edge Functions only call security-definer RPCs (claim_due_monitors,
// record_monitor_run, alert_worker_*) and one simple read, so this small client replaces supabase-js: no package to
// download at cold start, and tests stub fetch.
import { readEnv, supabaseUrl } from './env.ts'
import { withTimeout } from './http.ts'
import { errorMessage } from './log.ts'

export class DatabaseError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number, readonly details: string | null = null) {
    super(message)
    this.name = 'DatabaseError'
  }
}

export interface AdminClient {
  /** POST /rest/v1/rpc/<fn>. Resolves to the JSON result (null for void functions); throws DatabaseError. */
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>
  /** GET /rest/v1/<table>?<query> with PostgREST filters, e.g. `{ select: 'id,type', id: 'eq.<uuid>' }`. */
  select<T = Record<string, unknown>>(table: string, query: Record<string, string>): Promise<T[]>
}

export interface AdminClientOptions {
  url: string
  serviceKey: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export function createAdminClient(options: AdminClientOptions): AdminClient {
  const base = `${options.url.replace(/\/+$/, '')}/rest/v1`
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  const auth: Record<string, string> = { apikey: options.serviceKey, Accept: 'application/json' }
  // Legacy service_role keys are JWTs; new sb_secret_ keys only go in `apikey` (the gateway swaps them for a JWT).
  if (options.serviceKey.split('.').length === 3) auth.Authorization = `Bearer ${options.serviceKey}`

  async function call<T>(label: string, path: string, init: { method: string; body?: string }): Promise<T> {
    try {
      return await withTimeout(timeoutMs, async (signal) => {
        const response = await fetchImpl(`${base}${path}`, {
          method: init.method,
          headers: init.body === undefined ? auth : { ...auth, 'Content-Type': 'application/json' },
          body: init.body,
          signal,
        })
        const text = await response.text()
        if (!response.ok) {
          let body: Record<string, unknown> = {}
          try {
            body = JSON.parse(text) as Record<string, unknown>
          } catch {
            // Not a PostgREST error body (gateway error page).
          }
          const message = typeof body.message === 'string' ? body.message : `HTTP ${response.status}`
          throw new DatabaseError(`${label}: ${message}`, typeof body.code === 'string' ? body.code : null, response.status, typeof body.details === 'string' ? body.details : null)
        }
        return (text.trim() === '' ? null : JSON.parse(text)) as T
      })
    } catch (error) {
      if (error instanceof DatabaseError) throw error
      throw new DatabaseError(`${label}: ${errorMessage(error)}`, 'network_error', 0)
    }
  }

  return {
    rpc: <T>(fn: string, args: Record<string, unknown> = {}) => call<T>(`rpc ${fn}`, `/rpc/${encodeURIComponent(fn)}`, { method: 'POST', body: JSON.stringify(args) }),
    select: async <T>(table: string, query: Record<string, string>) => {
      const rows = await call<unknown>(`select ${table}`, `/${encodeURIComponent(table)}?${new URLSearchParams(query)}`, { method: 'GET' })
      return (Array.isArray(rows) ? rows : []) as T[]
    },
  }
}

/** The service key: SUPABASE_SERVICE_ROLE_KEY, or the default key of SUPABASE_SECRET_KEYS on projects without legacy keys. */
export function serviceRoleKey(): string | undefined {
  const legacy = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const keys = readEnv('SUPABASE_SECRET_KEYS')
  if (!keys) return undefined
  try {
    const parsed = JSON.parse(keys) as Record<string, unknown>
    return typeof parsed.default === 'string' && parsed.default !== '' ? parsed.default : undefined
  } catch {
    return undefined
  }
}

/** Client from SUPABASE_URL + service key, or null when either is missing. */
export function adminClientFromEnv(fetchImpl?: typeof fetch): AdminClient | null {
  const url = supabaseUrl()
  const key = serviceRoleKey()
  if (!url || !key) return null
  return createAdminClient({ url, serviceKey: key, fetch: fetchImpl })
}
