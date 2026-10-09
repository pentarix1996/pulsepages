// proxy.ts (Next 16, Node runtime): custom status page domains, api.<domain> rewrites, session refresh,
// protected routes and redirects from v1 URLs.
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PROTECTED_PREFIXES = ['/p/', '/projects', '/settings', '/onboarding']
const AUTH_PAGES = ['/login', '/register']

/** v1 URLs → v2 (spec §10). */
function legacyRedirect(pathname: string): string | null {
  if (pathname === '/dashboard') return '/projects'
  if (pathname === '/dashboard/settings/api') return '/settings/api-keys'
  if (pathname === '/settings') return '/settings/account'
  if (pathname === '/incidents' || pathname === '/monitoring' || pathname === '/alerts') return '/projects'
  const project = /^\/project\/([0-9a-f-]{36})(?:\/(monitoring|alerts))?\/?$/i.exec(pathname)
  if (project) {
    const section = project[2] === 'monitoring' ? 'monitors' : project[2] === 'alerts' ? 'alerts' : 'overview'
    return `/p/${project[1]}/${section}`
  }
  return null
}

function hostOf(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.toLowerCase()
  } catch {
    return null
  }
}

function isAppHost(host: string): boolean {
  const bare = host.split(':')[0]!
  // host.docker.internal: Edge Functions in the local Supabase stack call Next through it.
  if (bare === 'localhost' || bare === '127.0.0.1' || bare === 'host.docker.internal' || bare.endsWith('.vercel.app') || bare.endsWith('.local')) return true
  const appHost = hostOf(process.env.NEXT_PUBLIC_APP_URL)
  if (appHost && (host === appHost || bare === appHost.split(':')[0])) return true
  return false
}

interface DomainTarget {
  organization_slug: string
  project_slug: string
}

const domainCache = new Map<string, { target: DomainTarget | null; expires: number }>()

async function resolveCustomDomain(host: string): Promise<DomainTarget | null> {
  const key = host.split(':')[0]!.toLowerCase()
  const cached = domainCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.target
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  let target: DomainTarget | null = null
  try {
    const response = await fetch(`${url}/rest/v1/rpc/resolve_custom_domain`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_host: key }),
      cache: 'no-store',
    })
    if (response.ok) target = (await response.json()) as DomainTarget | null
  } catch {
    target = null
  }
  domainCache.set(key, { target, expires: Date.now() + (target ? 60_000 : 15_000) })
  if (domainCache.size > 5000) domainCache.delete(domainCache.keys().next().value!)
  return target
}

function withPathHeader(request: NextRequest): Headers {
  const headers = new Headers(request.headers)
  headers.set('x-upvane-path', request.nextUrl.pathname + request.nextUrl.search)
  return headers
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').toLowerCase()

  // RFC 8058 one-click unsubscribe: mail providers POST to the List-Unsubscribe URL (/subscriptions/unsubscribe),
  // which is a page for people; the POST goes to its route handler.
  if (request.method === 'POST' && pathname === '/subscriptions/unsubscribe' && !request.headers.has('next-action')) {
    const url = request.nextUrl.clone()
    url.pathname = '/api/public/subscriptions/unsubscribe'
    return NextResponse.rewrite(url)
  }

  // api.<domain>/v1/... → /api/v1/...
  const apiHost = process.env.UPVANE_API_HOST?.toLowerCase()
  if (apiHost && host.split(':')[0] === apiHost) {
    const url = request.nextUrl.clone()
    url.pathname = pathname.startsWith('/v1') ? `/api${pathname}` : pathname === '/' ? '/api/v1/openapi.json' : pathname
    return NextResponse.rewrite(url)
  }

  // Custom status page domains: status.example.com/... → /status/{org}/{slug}/...
  if (host && !isAppHost(host)) {
    if (pathname.startsWith('/_next') || pathname.startsWith('/api/public/') || pathname.startsWith('/subscriptions/') || pathname === '/favicon.ico') {
      return NextResponse.next()
    }
    const target = await resolveCustomDomain(host)
    const url = request.nextUrl.clone()
    if (!target) {
      url.pathname = '/status/domain-not-found'
      return NextResponse.rewrite(url)
    }
    url.pathname = `/status/${target.organization_slug}/${target.project_slug}${pathname === '/' ? '' : pathname}`
    const headers = withPathHeader(request)
    headers.set('x-upvane-custom-domain', host.split(':')[0]!)
    return NextResponse.rewrite(url, { request: { headers } })
  }

  const legacy = legacyRedirect(pathname)
  if (legacy) {
    const url = request.nextUrl.clone()
    url.pathname = legacy
    return NextResponse.redirect(url, 308)
  }

  // The public API, feeds and status pages do not use the dashboard session.
  if (pathname.startsWith('/api/v1') || pathname.startsWith('/status/') || pathname.startsWith('/api/public/')) {
    return NextResponse.next({ request: { headers: withPathHeader(request) } })
  }

  const { user, supabaseResponse } = await updateSession(request, withPathHeader(request))
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix))

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`
    return copyCookies(NextResponse.redirect(url), supabaseResponse)
  }

  if (AUTH_PAGES.includes(pathname) && user && !request.nextUrl.searchParams.has('invite')) {
    const url = request.nextUrl.clone()
    url.pathname = '/projects'
    url.search = ''
    return copyCookies(NextResponse.redirect(url), supabaseResponse)
  }

  return supabaseResponse
}

function copyCookies(response: NextResponse, from: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)'],
}
