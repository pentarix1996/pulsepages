// Legacy v0 public API (`/functions/v1/api/v1/projects/...`), now a thin proxy to the Next public API
// (`${PUBLIC_APP_URL}/api/v1/projects/...`), so both URLs behave the same. Successful v1 envelopes (`{ data }`) are
// renamed to the v0 keys; errors pass through as `{ error, code }`. Every answer is marked deprecated.
import { publicAppUrl } from '../_shared/edge/env.ts'
import { withTimeout } from '../_shared/edge/http.ts'
import { errorMessage, log } from '../_shared/edge/log.ts'

export const UPSTREAM_TIMEOUT_MS = 30_000

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, Idempotent-Replayed, Deprecation, Link',
}

const FORWARDED_REQUEST_HEADERS = ['authorization', 'content-type', 'idempotency-key', 'x-request-id']
const FORWARDED_RESPONSE_HEADERS = ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'idempotent-replayed']

/** `projects/...` part of a v0 path (`/functions/v1/api/v1/projects/x`, `/api/v1/projects/x` or `/v1/projects/x`). */
export function projectPath(pathname: string): string | null {
  const match = /(?:^|\/)v1\/(projects(?:\/[^?#]*)?)$/.exec(pathname)
  if (!match) return null
  const path = match[1]!.replace(/\/+$/, '')
  const segments = path.split('/')
  if (segments.some((segment) => segment === '')) return null
  for (const segment of segments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) return null
  }
  return path
}

/** v0 response key for a successful v1 answer; `null` returns the v1 `data` itself; undefined passes the body through. */
export function v0Key(path: string, method: string): string | null | undefined {
  const segments = path.split('/') // ['projects', '{id}', ...]
  if (segments.length === 2) return 'project'
  if (segments.length === 3 && segments[2] === 'status') return null
  if (segments[2] === 'components') {
    if (segments.length === 3) return method === 'POST' ? 'component' : 'components'
    if (segments.length === 4) return 'component'
  }
  if (segments[2] === 'incidents') {
    if (segments.length === 3) return method === 'POST' ? 'incident' : 'incidents'
    if (segments.length === 4) return 'incident'
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Renames `{ data, next_cursor? }` to the v0 shape for this route. */
export function toV0Body(path: string, method: string, body: unknown): unknown {
  if (!isRecord(body) || !('data' in body)) return body
  const key = v0Key(path, method)
  if (key === undefined) return body
  if (key === null) return body.data
  const renamed: Record<string, unknown> = { [key]: body.data }
  if ('next_cursor' in body) renamed.next_cursor = body.next_cursor
  return renamed
}

function responseHeaders(appUrl: string, upstream?: Headers): Headers {
  const headers = new Headers(CORS_HEADERS)
  headers.set('Deprecation', 'true')
  headers.set('Link', `<${appUrl}/api/v1/openapi.json>; rel="successor-version"`)
  headers.set('Cache-Control', 'no-store')
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream?.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

function json(body: unknown, status: number, headers: Headers): Response {
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

export async function handleApiRequest(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const appUrl = publicAppUrl()
  if (!appUrl) {
    log('error', 'api_proxy_not_configured', { reason: 'PUBLIC_APP_URL is not set.' })
    return json({ error: 'The API is not configured.', code: 'unavailable' }, 503, new Headers(CORS_HEADERS))
  }
  const url = new URL(request.url)
  const path = projectPath(url.pathname)
  if (!path) return json({ error: 'Route not found. Use /v1/projects/{project}/…', code: 'not_found' }, 404, responseHeaders(appUrl))

  const target = new URL(`${appUrl}/api/v1/${path}`)
  target.search = url.search
  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const body = hasBody ? await request.arrayBuffer() : undefined

  let upstream: Response
  let text: string
  try {
    ;[upstream, text] = await withTimeout(UPSTREAM_TIMEOUT_MS, async (signal) => {
      const response = await fetchImpl(target, { method: request.method, headers, body: body && body.byteLength > 0 ? body : undefined, redirect: 'manual', signal })
      return [response, await response.text()] as const
    })
  } catch (error) {
    log('error', 'api_proxy_upstream_failed', { method: request.method, path, error: errorMessage(error) })
    return json({ error: 'The API is temporarily unavailable. Try again in a moment.', code: 'unavailable' }, 503, responseHeaders(appUrl))
  }

  const out = responseHeaders(appUrl, upstream.headers)
  // v0 answered deletes with a body; v1 answers 204.
  if (upstream.status === 204 && request.method === 'DELETE') {
    const segments = path.split('/')
    const noun = segments[2] === 'incidents' ? 'Incident' : segments[2] === 'components' ? 'Component' : 'Resource'
    return json({ success: true, message: `${noun} deleted` }, 200, out)
  }
  if (upstream.status === 204 || upstream.status === 304) return new Response(null, { status: upstream.status, headers: out })

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not JSON (gateway error page): keep the status, answer the standard error envelope.
    if (upstream.status >= 400) return json({ error: 'The API answered an unexpected response.', code: upstream.status >= 500 ? 'internal' : 'invalid_request' }, upstream.status, out)
    const passthrough = new Headers(out)
    passthrough.set('Content-Type', upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8')
    return new Response(text, { status: upstream.status, headers: passthrough })
  }
  const status = upstream.status
  return json(status >= 200 && status < 300 ? toV0Body(path, request.method, parsed) : parsed, status, out)
}
