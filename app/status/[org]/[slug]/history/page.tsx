import type { Metadata } from 'next'
import { ChevronLeftIcon } from '@/components/ui/icons'
import { LocalTime } from '@/components/status/LocalTime'
import { IncidentSummary, MaintenanceSummary } from '@/components/status/page/Sections'
import { PrivateGate } from '@/components/status/page/PrivateGate'
import { StatusShell } from '@/components/status/page/StatusShell'
import { PAGE_PATHS, pageHref } from '@/lib/status-page/links'
import { formatStamp } from '@/lib/status-page/time'
import type { HistoryItem } from '@/lib/status-page/types'
import { appUrl, statusRoute, titleFor } from '../_view'
import '@/styles/status.css'

type Params = { org: string; slug: string }
const PAGE_SIZE = 25

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { org, slug } = await params
  return titleFor(org, slug, 'Incident history')
}

function isoParam(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export default async function HistoryPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, slug } = await params
  const query = await searchParams
  const view = await statusRoute(org, slug, query, '/history')
  if (view.kind === 'gate') return <PrivateGate stub={view.stub} location={view.location} appUrl={appUrl()} />
  const { page, location } = view
  const before = isoParam(query.before)
  const after = isoParam(query.after)
  const payload = after ? await view.reader.historyNewer(after, PAGE_SIZE + 1) : await view.reader.history(before, PAGE_SIZE + 1)
  const all = payload?.items ?? []
  const hasMore = all.length > PAGE_SIZE
  // Newer pages come back newest first too; drop the extra item at the far end of the direction we moved in.
  const items: HistoryItem[] = after ? (hasMore ? all.slice(all.length - PAGE_SIZE) : all) : all.slice(0, PAGE_SIZE)
  const timeZone = page.project.timezone
  const months = new Map<string, HistoryItem[]>()
  for (const item of items) {
    const key = formatStamp(item.at, 'month-year', timeZone)
    months.set(key, [...(months.get(key) ?? []), item])
  }
  const newest = items[0]?.at ?? null
  const oldest = items[items.length - 1]?.at ?? null
  const showNewer = Boolean(before || (after && hasMore))
  const showOlder = after ? true : hasMore
  const historyDays = page.project.history_days

  return (
    <StatusShell project={page.project} location={location} page={page} appUrl={appUrl()}>
      <main className="sp-wrap sp-main">
        <a className="sp-back" href={pageHref(location)}>
          <ChevronLeftIcon size={16} /> Current status
        </a>
        <section className="sp-card sp-past" aria-labelledby="sp-history-title">
          <div className="sp-card-head">
            <h2 id="sp-history-title">Incident history</h2>
            <span className="sp-faint">Incidents and maintenance from the last {historyDays} days.</span>
          </div>
          {items.length === 0 ? (
            <div className="sp-day">
              <span className="sp-day-label">Nothing yet</span>
              <span className="sp-day-empty">No incidents or maintenance in this period.</span>
            </div>
          ) : null}
          {[...months.entries()].map(([month, list]) => (
            <div className="sp-day" key={month}>
              <span className="sp-day-label">{month}</span>
              <div className="sp-day-items">
                {list.map((item) =>
                  item.kind === 'incident' ? (
                    <div key={`i-${item.item.id}`} className="stack" style={{ gap: 2 }}>
                      <span className="sp-faint">
                        <LocalTime value={item.at} format="date" />
                      </span>
                      <IncidentSummary incident={item.item} location={location} ongoing={item.item.status !== 'resolved'} />
                    </div>
                  ) : (
                    <div key={`m-${item.item.id}`} className="stack" style={{ gap: 2 }}>
                      <span className="sp-faint">
                        <LocalTime value={item.at} format="date" />
                      </span>
                      <MaintenanceSummary maintenance={item.item} location={location} />
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
          {showNewer || showOlder ? (
            <nav className="sp-pager" aria-label="History pages">
              {showNewer && newest ? <a href={pageHref(location, `${PAGE_PATHS.history}?after=${encodeURIComponent(newest)}`)}>Newer</a> : <span />}
              {showOlder && oldest ? <a href={pageHref(location, `${PAGE_PATHS.history}?before=${encodeURIComponent(oldest)}`)}>Older</a> : null}
            </nav>
          ) : null}
        </section>
      </main>
    </StatusShell>
  )
}
