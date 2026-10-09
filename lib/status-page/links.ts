// Every link a status page renders goes through these helpers, so the same page works under
// /status/{org}/{slug} on the Upvane host and at the root of a customer's custom domain (proxy.ts rewrites those).
// Pure: safe on server and client.
import { statusPageUrl } from '@shared/alerts/message.ts'

export interface PageLocation {
  organizationSlug: string
  projectSlug: string
  /** Verified custom domain of the page; absolute links (feeds, canonical, emails) prefer it. */
  customDomain: string | null
  /** True when this request arrived through the custom domain: relative links start at "/". */
  onCustomDomain: boolean
}

/** Sub-paths relative to the page root. */
export const PAGE_PATHS = {
  root: '',
  history: '/history',
  rss: '/feed.rss',
  atom: '/feed.atom',
  summaryJson: '/api/v2/summary.json',
  statusJson: '/api/v2/status.json',
  incident: (id: string) => `/incidents/${encodeURIComponent(id)}`,
  maintenance: (id: string) => `/maintenance/${encodeURIComponent(id)}`,
} as const

function normalizeSubPath(subPath: string): string {
  if (!subPath) return ''
  if (subPath.startsWith('?') || subPath.startsWith('#')) return subPath
  return subPath.startsWith('/') ? subPath : `/${subPath}`
}

/** Path prefix of the page on this host: "" on its custom domain, "/status/{org}/{slug}" otherwise. */
export function pageBasePath(location: PageLocation): string {
  if (location.onCustomDomain) return ''
  return `/status/${encodeURIComponent(location.organizationSlug)}/${encodeURIComponent(location.projectSlug)}`
}

/** Relative href for a sub-path of the page ("" is the page root, query strings are allowed). */
export function pageHref(location: PageLocation, subPath = ''): string {
  const sub = normalizeSubPath(subPath)
  const base = pageBasePath(location)
  if (!base) return sub === '' || sub.startsWith('?') || sub.startsWith('#') ? `/${sub}` : sub
  return `${base}${sub}`
}

/** Absolute URL of a sub-path: the verified custom domain when there is one, the Upvane host otherwise. */
export function pageUrl(location: PageLocation, appUrl: string, subPath = ''): string {
  const sub = normalizeSubPath(subPath)
  if (sub.startsWith('?') || sub.startsWith('#')) {
    return `${statusPageUrl({ organization_slug: location.organizationSlug, slug: location.projectSlug, custom_domain: location.customDomain }, { appUrl })}${location.customDomain ? '/' : ''}${sub}`
  }
  return statusPageUrl({ organization_slug: location.organizationSlug, slug: location.projectSlug, custom_domain: location.customDomain }, { appUrl }, sub)
}

/** Public API routes are served as-is on custom domains too (proxy.ts), so this path works on both hosts. */
export function publicApiPath(location: Pick<PageLocation, 'organizationSlug' | 'projectSlug'>, action: 'subscribe' | 'access'): string {
  return `/api/public/status/${encodeURIComponent(location.organizationSlug)}/${encodeURIComponent(location.projectSlug)}/${action}`
}

/** Where the browser exchanges an access link for a cookie. `next` is the page-relative path to return to. */
export function accessExchangeHref(location: Pick<PageLocation, 'organizationSlug' | 'projectSlug'>, token: string, next: string): string {
  const query = new URLSearchParams({ token, next: next || '/' })
  return `${publicApiPath(location, 'access')}?${query.toString()}`
}

/**
 * Reduces a requested return path to a safe page-relative path ("/", "/incidents/…", "/history?before=…").
 * Accepts either a page-relative path or the full /status/{org}/{slug}/… path; anything else returns "/".
 */
export function safeNextPath(location: Pick<PageLocation, 'organizationSlug' | 'projectSlug'>, raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string' || raw.length > 512) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  let url: URL
  try {
    url = new URL(raw, 'https://status.invalid')
  } catch {
    return '/'
  }
  if (url.host !== 'status.invalid') return '/'
  let path = url.pathname
  const prefix = `/status/${location.organizationSlug}/${location.projectSlug}`.toLowerCase()
  if (path.toLowerCase() === prefix) path = '/'
  else if (path.toLowerCase().startsWith(`${prefix}/`)) path = path.slice(prefix.length)
  if (!/^\/(?:$|incidents\/[\w-]+$|maintenance\/[\w-]+$|history$)/.test(path)) return '/'
  url.searchParams.delete('access_token')
  url.searchParams.delete('access')
  const search = url.searchParams.toString()
  return `${path}${search ? `?${search}` : ''}`
}

/** Bare host of a Host / X-Forwarded-Host header value (lowercase, no port). */
export function bareHost(value: string | null | undefined): string | null {
  if (!value) return null
  const first = value.split(',')[0]!.trim().toLowerCase()
  if (!first) return null
  if (first.startsWith('[')) return first.slice(0, first.indexOf(']') + 1) || null
  return first.split(':')[0] || null
}

/**
 * Whether the request came through the page's custom domain. proxy.ts sets x-upvane-custom-domain to the request
 * host; a client could send the header itself, so it only counts when it matches the host and the verified domain.
 */
export function isCustomDomainRequest(input: { headerDomain: string | null | undefined; host: string | null | undefined; projectDomain: string | null | undefined }): boolean {
  const header = input.headerDomain?.trim().toLowerCase()
  if (!header) return false
  if (bareHost(input.host) !== header) return false
  if (input.projectDomain && input.projectDomain.toLowerCase() !== header) return false
  return true
}

/** Login link for a private page: always on the Upvane host, where the session cookie lives. */
export function signInUrl(location: PageLocation, appUrl: string, subPath = ''): string {
  const next = `/status/${location.organizationSlug}/${location.projectSlug}${normalizeSubPath(subPath).startsWith('/') ? normalizeSubPath(subPath) : ''}`
  return `${appUrl.replace(/\/+$/, '')}/login?next=${encodeURIComponent(next)}`
}
