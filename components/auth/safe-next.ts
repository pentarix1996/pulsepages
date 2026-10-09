// Where to send someone after signing in. Pure and isomorphic: used by the auth forms and by /auth/callback.

const BASE = 'https://upvane.invalid'
export const DEFAULT_DESTINATION = '/projects'

/** Invitation tokens look like inv_<base62>; anything else is ignored. */
const INVITE_TOKEN = /^inv_[A-Za-z0-9]{20,128}$/

export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN.test(value)
}

/** Auth pages and API routes are never a destination (loops, JSON pages). */
function isBlockedPath(path: string): boolean {
  const lower = path.toLowerCase()
  return (
    lower === '/login' ||
    lower.startsWith('/login/') ||
    lower === '/register' ||
    lower.startsWith('/register/') ||
    lower === '/auth' ||
    lower.startsWith('/auth/') ||
    lower === '/api' ||
    lower.startsWith('/api/')
  )
}

/**
 * Returns `value` when it is a path on this site (`/settings/members?invite=1`), otherwise `fallback`.
 * Rejects absolute and protocol-relative URLs (`https://evil.example`, `//evil.example`, `/\evil.example`),
 * control characters, auth pages and API routes.
 */
export function safeNext(value: string | null | undefined, fallback: string = DEFAULT_DESTINATION): string {
  if (typeof value !== 'string') return fallback
  const candidate = value.trim()
  if (candidate.length === 0 || candidate.length > 2048) return fallback
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback
  if (candidate.includes('\\')) return fallback
  if (/[\u0000-\u001F\u007F]/.test(candidate)) return fallback
  let url: URL
  try {
    url = new URL(candidate, BASE)
  } catch {
    return fallback
  }
  if (url.origin !== BASE) return fallback
  if (isBlockedPath(url.pathname)) return fallback
  return `${url.pathname}${url.search}${url.hash}`
}

/** Destination after authentication: the invitation when there is one, else a safe `next`. */
export function authDestination(options: { next?: string | null; invite?: string | null }, fallback: string = DEFAULT_DESTINATION): string {
  if (isInviteToken(options.invite)) return `/invite/${options.invite}`
  return safeNext(options.next, fallback)
}

/** Query string that carries `next` and `invite` between the auth pages. */
export function authQuery(options: { next?: string | null; invite?: string | null; email?: string | null }): string {
  const params = new URLSearchParams()
  if (isInviteToken(options.invite)) params.set('invite', options.invite)
  const next = options.next ? safeNext(options.next, '') : ''
  if (next && next !== DEFAULT_DESTINATION) params.set('next', next)
  if (options.email) params.set('email', options.email)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** URL Supabase sends people back to from email links and identity providers (PKCE code exchange). */
export function callbackUrl(origin: string, destination: string): string {
  return `${origin.replace(/\/+$/, '')}/auth/callback?next=${encodeURIComponent(safeNext(destination))}`
}
