'use client'

// Client helper for the dashboard's internal API (/api/app/**). Errors carry the server's readable message.

export class AppRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: Array<{ path: string; message: string }>

  constructor(message: string, code: string, status: number, details?: Array<{ path: string; message: string }>) {
    super(message)
    this.name = 'AppRequestError'
    this.code = code
    this.status = status
    this.details = details
  }

  /** Validation messages keyed by field path, for inline errors. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((detail) => [detail.path, detail.message]))
  }
}

export async function appRequest<T = unknown>(path: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const url = path.startsWith('/api/') ? path : `/api/app${path.startsWith('/') ? path : `/${path}`}`
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      credentials: 'same-origin',
    })
  } catch {
    throw new AppRequestError('Could not reach Upvane. Check your connection and try again.', 'network', 0)
  }
  if (response.status === 204) return undefined as T
  let payload: { data?: T; error?: string; code?: string; details?: Array<{ path: string; message: string }> } = {}
  try {
    payload = await response.json()
  } catch {
    // non-JSON error page
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
    }
    throw new AppRequestError(payload.error ?? 'Something went wrong. Try again in a moment.', payload.code ?? 'internal', response.status, payload.details)
  }
  return payload.data as T
}
