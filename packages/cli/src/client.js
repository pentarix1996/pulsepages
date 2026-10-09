// Minimal client for the Upvane REST API (/v1). Uses the global fetch of Node 18+.
import { randomUUID } from 'node:crypto'

export const DEFAULT_API_URL = 'https://api.upvane.com/v1'

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function createClient({ apiUrl = DEFAULT_API_URL, apiKey, fetchImpl = globalThis.fetch, userAgent = 'upvane-cli' } = {}) {
  const base = apiUrl.replace(/\/+$/, '')

  async function request(method, path, { body, query, idempotent = false } = {}) {
    if (!apiKey) throw new ApiError('Set UPVANE_API_KEY (or pass --api-key) with a key from Settings → API keys.', 0, 'unauthorized')
    const url = new URL(base + path)
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': userAgent }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (idempotent) headers['Idempotency-Key'] = randomUUID()
    let lastError
    for (let attempt = 0; attempt < 3; attempt++) {
      let response
      try {
        response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      } catch (error) {
        lastError = new ApiError(`Could not reach ${url.host}: ${error instanceof Error ? error.message : error}`, 0, 'network')
        if (!idempotent && method !== 'GET') throw lastError
        await sleep(500 * 2 ** attempt)
        continue
      }
      if (response.status === 204) return null
      const text = await response.text()
      let payload = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = null
      }
      if (response.ok) return payload
      const error = new ApiError(payload?.error ?? `HTTP ${response.status}`, response.status, payload?.code ?? 'http_error', payload?.details)
      // Retry rate limits and server errors when the request is safe to repeat.
      if ((response.status === 429 || response.status >= 500) && (method === 'GET' || idempotent) && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 500 * 2 ** attempt)
        lastError = error
        continue
      }
      throw error
    }
    throw lastError
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body, options = {}) => request('POST', path, { body, idempotent: options.idempotent ?? true }),
    patch: (path, body) => request('PATCH', path, { body }),
    put: (path, body) => request('PUT', path, { body }),
    delete: (path) => request('DELETE', path),
    /** Every item of a paginated list. */
    async all(path, query = {}) {
      const items = []
      let cursor = null
      for (let page = 0; page < 50; page++) {
        const result = await request('GET', path, { query: { ...query, limit: 100, cursor } })
        items.push(...(result?.data ?? []))
        cursor = result?.next_cursor ?? null
        if (!cursor) break
      }
      return items
    },
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
