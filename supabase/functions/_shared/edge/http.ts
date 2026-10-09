// HTTP helpers for the Edge Functions: JSON responses, timeouts that also cover reading the body, and bounded reads.

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const merged = new Headers(headers)
  merged.set('Content-Type', 'application/json; charset=utf-8')
  if (!merged.has('Cache-Control')) merged.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers: merged })
}

/** `{ error, code }`, the error envelope used across Upvane. */
export function errorResponse(status: number, code: string, message: string, headers: HeadersInit = {}): Response {
  return jsonResponse({ error: message, code }, status, headers)
}

/** Parses a JSON body; an empty body is `null`. */
export async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false }
  }
  if (text.trim() === '') return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

export function timeoutError(timeoutMs: number): DOMException {
  return new DOMException(`Timed out after ${timeoutMs} ms.`, 'TimeoutError')
}

/**
 * Runs `task` with a signal that aborts after `timeoutMs` (or when `parent` aborts). The timer is cleared when the
 * task settles, so the deadline covers the request and reading its body.
 */
export async function withTimeout<T>(timeoutMs: number, task: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs)
  const onParentAbort = () => controller.abort(parent?.reason)
  if (parent?.aborted) controller.abort(parent.reason)
  else parent?.addEventListener('abort', onParentAbort, { once: true })
  try {
    return await task(controller.signal)
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', onParentAbort)
  }
}

export interface LimitedText {
  text: string
  bytes: number
  truncated: boolean
}

/** Reads at most `maxBytes` of a body (decoded as UTF-8) and cancels the rest. */
export async function readTextLimited(response: Response, maxBytes: number): Promise<LimitedText> {
  if (!response.body) return { text: '', bytes: 0, truncated: false }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (bytes + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - bytes))
        bytes = maxBytes
        truncated = true
        break
      }
      chunks.push(value)
      bytes += value.byteLength
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(merged), bytes, truncated }
}

/** Releases a body we do not need (keeps connections reusable, avoids leaking resources in tests). */
export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Already consumed or errored: nothing to release.
  }
}
