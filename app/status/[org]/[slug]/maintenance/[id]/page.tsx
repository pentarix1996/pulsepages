import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon } from '@/components/ui/icons'
import { LocalTime } from '@/components/status/LocalTime'
import { PrivateGate } from '@/components/status/page/PrivateGate'
import { StatusShell } from '@/components/status/page/StatusShell'
import { loadStatusView } from '@/lib/status-page/access'
import { pageHref } from '@/lib/status-page/links'
import { isUuid } from '@/lib/status-page/types'
import { durationBetween, maintenanceStatusLabel } from '@/lib/status-page/view'
import { appUrl, statusRoute, titleFor } from '../../_view'
import '@/styles/status.css'

type Params = { org: string; slug: string; id: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { org, slug, id } = await params
  const view = await loadStatusView(org, slug)
  if (view.kind === 'page' && isUuid(id)) {
    const payload = await view.reader.maintenance(id).catch(() => null)
    if (payload) return titleFor(org, slug, payload.maintenance.title)
  }
  return titleFor(org, slug, 'Maintenance')
}

export default async function MaintenancePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, slug, id } = await params
  const view = await statusRoute(org, slug, await searchParams, `/maintenance/${id}`)
  if (view.kind === 'gate') return <PrivateGate stub={view.stub} location={view.location} appUrl={appUrl()} />
  if (!isUuid(id)) notFound()
  const payload = await view.reader.maintenance(id)
  if (!payload) notFound()
  const { maintenance } = payload
  const { page, location } = view
  const start = maintenance.actual_start ?? maintenance.scheduled_start
  const end = maintenance.actual_end ?? maintenance.scheduled_end

  return (
    <StatusShell project={page.project} location={location} page={page} appUrl={appUrl()}>
      <main className="sp-wrap sp-main">
        <a className="sp-back" href={pageHref(location)}>
          <ChevronLeftIcon size={16} /> Current status
        </a>
        <article className="sp-card sp-detail" aria-labelledby="sp-maint-title">
          <h1 id="sp-maint-title">{maintenance.title}</h1>
          <div className="sp-chips">
            <span className="sp-chip s-maintenance">{maintenanceStatusLabel(maintenance.status)}</span>
            {maintenance.components.map((component) => (
              <span key={component.id} className="sp-chip">
                {component.name}
              </span>
            ))}
          </div>
          <div className="sp-detail-meta">
            <span>
              <LocalTime value={start} format="datetime-full-tz" /> to <LocalTime value={end} format="end-tz" relativeTo={start} />
            </span>
            {maintenance.status === 'completed' ? <span>Took {durationBetween(start, end) ?? 'no time'}</span> : <span>Planned for {durationBetween(maintenance.scheduled_start, maintenance.scheduled_end)}</span>}
          </div>
          {maintenance.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{maintenance.description}</p> : null}
          <div>
            {maintenance.updates.map((update) => (
              <div className="sp-upd" key={update.id}>
                <div className="sp-upd-meta">
                  <strong className="s-maintenance">{maintenanceStatusLabel(update.status)}</strong>
                  <LocalTime value={update.created_at} format="datetime" />
                </div>
                <div className="sp-upd-body">
                  <p>{update.message}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </main>
    </StatusShell>
  )
}
