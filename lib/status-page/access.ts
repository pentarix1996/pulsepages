import 'server-only'
// Who may see a status page. Public pages: everyone (cached anonymous read). Private pages: organization members
// (their Supabase session), visitors holding an access link (cookie set by the exchange route, re-checked on every
// request) and visitors from an allow-listed network. Everyone else gets the "This status page is private" gate.
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { sha256Hex } from '@shared/crypto.ts'
import { accessCookieName, hasSupabaseSessionCookie, isAccessToken } from './access-cookie'
import { clientIp, ipAllowed } from './cidr'
import { adminRpc, getAccessInfo, getPagePayload, getPublicPayload, privateReader, publicReader, type StatusReader } from './data'
import { isCustomDomainRequest, type PageLocation } from './links'
import type { PrivatePageStub, StatusPageData } from './types'

export type AccessVia = 'public' | 'member' | 'token' | 'ip'

export type StatusView =
  | { kind: 'not_found' }
  | { kind: 'gate'; stub: PrivatePageStub['project']; location: PageLocation }
  | { kind: 'page'; access: AccessVia; page: StatusPageData; location: PageLocation; reader: StatusReader }

export interface RequestCookies {
  get(name: string): { value: string } | undefined
  getAll(): Array<{ name: string; value: string }>
}

export interface RequestContext {
  headers: Pick<Headers, 'get'>
  cookies: RequestCookies
}

export function pageLocation(project: { organization_slug: string; slug: string; custom_domain?: string | null }, requestHeaders: Pick<Headers, 'get'>): PageLocation {
  const customDomain = project.custom_domain ?? null
  return {
    organizationSlug: project.organization_slug,
    projectSlug: project.slug,
    customDomain,
    onCustomDomain: isCustomDomainRequest({
      headerDomain: requestHeaders.get('x-upvane-custom-domain'),
      host: requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
      projectDomain: customDomain,
    }),
  }
}

/** True when the access link is valid for the page (also records its last use). */
export async function checkAccessToken(projectId: string, token: string): Promise<boolean> {
  if (!isAccessToken(token)) return false
  return (await adminRpc<boolean>('check_status_page_access', { p_project_id: projectId, p_token_hash: await sha256Hex(token) })) === true
}

export async function resolvePrivateAccess(stub: PrivatePageStub['project'], request: RequestContext): Promise<{ via: AccessVia; page: StatusPageData; reader: StatusReader } | null> {
  const org = stub.organization_slug
  const slug = stub.slug

  // 1. Organization members, through their own session (RLS decides).
  if (hasSupabaseSessionCookie(request.cookies.getAll().map((cookie) => cookie.name))) {
    try {
      const payload = await getPagePayload('session', org, slug)
      if (payload && !payload.private) return { via: 'member', page: payload, reader: privateReader('session', org, slug) }
    } catch (error) {
      console.warn('[status-page] member check failed', error instanceof Error ? error.message : error)
    }
  }

  // 2. Access link stored in the page's cookie, re-checked on every request so revocation applies at once.
  let via: AccessVia | null = null
  const token = request.cookies.get(accessCookieName(stub.id))?.value
  if (token && (await checkAccessToken(stub.id, token))) via = 'token'

  // 3. Allow-listed networks (projects.allowed_ips) by the client address the platform reports.
  if (!via) {
    const ip = clientIp(request.headers)
    if (ip) {
      const info = await getAccessInfo(stub.id)
      if (info && info.visibility === 'private' && ipAllowed(ip, info.allowed_ips)) via = 'ip'
    }
  }

  if (!via) return null
  const payload = await getPagePayload('admin', org, slug)
  if (!payload || payload.private) return null
  return { via, page: payload, reader: privateReader('admin', org, slug) }
}

export async function resolveStatusView(org: string, slug: string, request: RequestContext): Promise<StatusView> {
  const payload = await getPublicPayload(org, slug)
  if (!payload) return { kind: 'not_found' }
  if (!payload.private) {
    const project = payload.project
    return { kind: 'page', access: 'public', page: payload, location: pageLocation(project, request.headers), reader: publicReader(project.organization_slug, project.slug) }
  }
  const granted = await resolvePrivateAccess(payload.project, request)
  if (granted) return { kind: 'page', access: granted.via, page: granted.page, location: pageLocation(granted.page.project, request.headers), reader: granted.reader }
  return { kind: 'gate', stub: payload.project, location: pageLocation({ ...payload.project, custom_domain: null }, request.headers) }
}

export async function currentRequest(): Promise<RequestContext> {
  const [requestHeaders, requestCookies] = await Promise.all([headers(), cookies()])
  return { headers: requestHeaders, cookies: requestCookies }
}

/** Per-request memo, shared by generateMetadata and the page. Never cached across requests. */
export const loadStatusView = cache(async (org: string, slug: string): Promise<StatusView> => resolveStatusView(org, slug, await currentRequest()))

/** Cache-Control for responses built from a view: shared caches only for public pages. */
export function cacheControlFor(view: StatusView): string {
  return view.kind === 'page' && view.access === 'public' ? 'public, s-maxage=30, stale-while-revalidate=60' : 'private, no-store'
}
