// Calls to the Upvane API used by the action. Network errors, 429 and 5xx are retried; the idempotency key makes
// retries safe.
import { randomUUID } from 'node:crypto'

export async function api(fetchImpl, { apiUrl, apiKey }, method, path, body, { attempts = 3, delayMs = 1000 } = {}) {
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': 'upvane-maintenance-action/1', 'Idempotency-Key': randomUUID() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let last = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt - 1)))
    let response
    try {
      response = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
    } catch (error) {
      last = new Error(`network error (${error instanceof Error ? error.message : error})`)
      continue
    }
    const payload = await response.json().catch(() => null)
    if (response.ok) return payload?.data ?? null
    const error = new Error(`${payload?.error ?? `HTTP ${response.status}`}${payload?.code ? ` (${payload.code})` : ''}`)
    if (response.status === 429 || response.status >= 500) {
      last = error
      continue
    }
    throw error
  }
  throw last ?? new Error('request failed')
}

export function projectPath(project) {
  return `/projects/${encodeURIComponent(project)}`
}
