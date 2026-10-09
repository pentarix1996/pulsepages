// Access links for private status pages: `?access_token=spat_…` is exchanged once (app/api/public/status/[org]/
// [slug]/access) for an httpOnly cookie scoped to the page, and every later request re-checks that cookie with
// check_status_page_access(). Pure helpers, shared by the exchange route, the pages and the tests.
import type { PageLocation } from './links'

/** spat_ + base62 (lib/domain/access-tokens.ts generates 43 characters). */
export const ACCESS_TOKEN_PATTERN = /^spat_[A-Za-z0-9]{16,128}$/

/** How long the browser keeps an exchanged access link. Revocation still applies at once (checked per request). */
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export function isAccessToken(value: unknown): value is string {
  return typeof value === 'string' && ACCESS_TOKEN_PATTERN.test(value)
}

/** One cookie per page, so several private pages on the Upvane host never collide. */
export function accessCookieName(projectId: string): string {
  return `upv_access_${projectId.replace(/[^0-9a-f]/gi, '').toLowerCase()}`
}

/**
 * Paths the cookie is scoped to. On the Upvane host: the page and its public API (subscribe); on the page's own
 * custom domain the whole host is the page.
 */
export function accessCookiePaths(location: Pick<PageLocation, 'organizationSlug' | 'projectSlug' | 'onCustomDomain'>): string[] {
  if (location.onCustomDomain) return ['/']
  const org = encodeURIComponent(location.organizationSlug)
  const slug = encodeURIComponent(location.projectSlug)
  return [`/status/${org}/${slug}`, `/api/public/status/${org}/${slug}`]
}

export interface CookieAttributes {
  name: string
  value: string
  path: string
  maxAge: number
  secure?: boolean
}

/** Set-Cookie value: httpOnly, Secure, SameSite=Lax, path-scoped. */
export function serializeAccessCookie({ name, value, path, maxAge, secure = true }: CookieAttributes): string {
  if (!/^[\w-]+$/.test(name)) throw new Error('Invalid cookie name.')
  if (!/^[\w-]*$/.test(value)) throw new Error('Invalid cookie value.')
  return [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, 'HttpOnly', secure ? 'Secure' : '', 'SameSite=Lax'].filter(Boolean).join('; ')
}

export function accessCookieHeaders(projectId: string, token: string, location: Pick<PageLocation, 'organizationSlug' | 'projectSlug' | 'onCustomDomain'>): string[] {
  return accessCookiePaths(location).map((path) => serializeAccessCookie({ name: accessCookieName(projectId), value: token, path, maxAge: ACCESS_COOKIE_MAX_AGE }))
}

/** Expires the cookie on every path (used when a stored link stops working). */
export function clearAccessCookieHeaders(projectId: string, location: Pick<PageLocation, 'organizationSlug' | 'projectSlug' | 'onCustomDomain'>): string[] {
  return accessCookiePaths(location).map((path) => serializeAccessCookie({ name: accessCookieName(projectId), value: '', path, maxAge: 0 }))
}

/** Supabase auth cookies (sb-<ref>-auth-token, possibly chunked). Without one there is no member session to try. */
export function hasSupabaseSessionCookie(names: string[]): boolean {
  return names.some((name) => /^sb-[\w-]+-auth-token(?:\.\d+)?$/.test(name))
}
