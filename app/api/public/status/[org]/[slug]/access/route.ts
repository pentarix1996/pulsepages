// GET /api/public/status/{org}/{slug}/access?token=spat_…&next=/… — turns an access link into a cookie for this page
// and sends the visitor back without the token in the address bar. The cookie is re-checked on every request.
import { accessCookieHeaders, isAccessToken } from '@/lib/status-page/access-cookie'
import { checkAccessToken, currentRequest, pageLocation } from '@/lib/status-page/access'
import { getPublicPayload } from '@/lib/status-page/data'
import { pageHref, safeNextPath } from '@/lib/status-page/links'

type Params = { params: Promise<{ org: string; slug: string }> }

export async function GET(request: Request, { params }: Params) {
  const { org, slug } = await params
  const url = new URL(request.url)
  const payload = await getPublicPayload(org, slug)
  if (!payload) return new Response('Status page not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const { headers } = await currentRequest()
  const project = payload.project
  const location = pageLocation({ organization_slug: project.organization_slug, slug: project.slug, custom_domain: payload.private ? null : payload.project.custom_domain }, headers)
  const next = safeNextPath(location, url.searchParams.get('next'))
  const token = url.searchParams.get('token') ?? ''

  // Public pages need no token: drop it and continue.
  if (!payload.private) return Response.redirect(new URL(pageHref(location, next), request.url), 303)

  if (!isAccessToken(token) || !(await checkAccessToken(project.id, token))) {
    return Response.redirect(new URL(pageHref(location, `?access=invalid`), request.url), 303)
  }
  const response = new Response(null, { status: 303, headers: { Location: new URL(pageHref(location, next), request.url).toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  for (const cookie of accessCookieHeaders(project.id, token, location)) response.headers.append('Set-Cookie', cookie)
  return response
}
