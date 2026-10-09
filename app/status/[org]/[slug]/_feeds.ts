import 'server-only'
import { env } from '@/lib/env'
import { cacheControlFor, currentRequest, resolveStatusView } from '@/lib/status-page/access'
import { buildAtom, buildRss, FEED_LIMIT, feedEntries, feedUpdated } from '@/lib/status-page/feeds'
import { PAGE_PATHS, pageUrl } from '@/lib/status-page/links'
import { buildStatusJson, buildSummaryJson } from '@/lib/status-page/summary'
import { pageTitle } from '@/lib/status-page/view'

type Params = Promise<{ org: string; slug: string }>

const NOT_FOUND = () => Response.json({ error: 'Status page not found.', code: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

/** RSS or Atom feed of the page (incidents and maintenance, newest first). Private pages need the same access as the page. */
export async function feedResponse(params: Params, kind: 'rss' | 'atom'): Promise<Response> {
  const { org, slug } = await params
  const view = await resolveStatusView(org, slug, await currentRequest())
  if (view.kind !== 'page') return NOT_FOUND()
  const appUrl = env.appUrl()
  const history = await view.reader.history(null, FEED_LIMIT)
  const entries = feedEntries(history?.items ?? [], view.page.maintenances.filter((item) => item.status === 'scheduled'), view.location, appUrl)
  const document = {
    title: pageTitle(view.page.project),
    description: `Incidents and maintenance for ${view.page.project.name}.`,
    pageUrl: pageUrl(view.location, appUrl),
    selfUrl: pageUrl(view.location, appUrl, kind === 'rss' ? PAGE_PATHS.rss : PAGE_PATHS.atom),
    author: view.page.project.organization_name,
    updated: feedUpdated(entries, view.page.generated_at),
    entries,
  }
  return new Response(kind === 'rss' ? buildRss(document) : buildAtom(document), {
    headers: {
      'Content-Type': kind === 'rss' ? 'application/rss+xml; charset=utf-8' : 'application/atom+xml; charset=utf-8',
      'Cache-Control': cacheControlFor(view),
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** Statuspage-compatible JSON (summary.json / status.json). Public pages allow any origin. */
export async function jsonResponse(params: Params, kind: 'summary' | 'status'): Promise<Response> {
  const { org, slug } = await params
  const view = await resolveStatusView(org, slug, await currentRequest())
  if (view.kind !== 'page') return NOT_FOUND()
  const context = { location: view.location, appUrl: env.appUrl() }
  const body = kind === 'summary' ? buildSummaryJson(view.page, context) : buildStatusJson(view.page, context)
  const headers: Record<string, string> = { 'Cache-Control': cacheControlFor(view) }
  if (view.access === 'public') headers['Access-Control-Allow-Origin'] = '*'
  return Response.json(body, { headers })
}
