import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon } from '@/components/ui/icons'
import { LocalTime } from '@/components/status/LocalTime'
import { PrivateGate } from '@/components/status/page/PrivateGate'
import { ImpactChips, UpdateRow } from '@/components/status/page/Sections'
import { StatusShell } from '@/components/status/page/StatusShell'
import { loadStatusView } from '@/lib/status-page/access'
import { pageHref } from '@/lib/status-page/links'
import { isUuid, type StatusPostmortem } from '@/lib/status-page/types'
import { componentNameMap, durationBetween, incidentStatusLabel } from '@/lib/status-page/view'
import { appUrl, statusRoute, titleFor } from '../../_view'
import '@/styles/status.css'

type Params = { org: string; slug: string; id: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { org, slug, id } = await params
  const view = await loadStatusView(org, slug)
  if (view.kind === 'page' && isUuid(id)) {
    const payload = await view.reader.incident(id).catch(() => null)
    if (payload) return titleFor(org, slug, payload.incident.title)
  }
  return titleFor(org, slug, 'Incident')
}

function Postmortem({ postmortem }: { postmortem: StatusPostmortem }) {
  const sections: Array<[string, string | null]> = [
    ['Summary', postmortem.summary],
    ['Impact', postmortem.impact],
    ['Root cause', postmortem.root_cause],
    ['Resolution', postmortem.resolution],
    ['What we are changing', postmortem.lessons],
  ]
  return (
    <section className="sp-card sp-pm" aria-labelledby="sp-pm-title">
      <div className="sp-maint-title">
        <h2 id="sp-pm-title">{postmortem.title || 'Postmortem'}</h2>
        {postmortem.published_at ? (
          <span className="sp-faint">
            Published <LocalTime value={postmortem.published_at} format="date-year" />
          </span>
        ) : null}
      </div>
      {sections
        .filter(([, text]) => text && text.trim())
        .map(([title, text]) => (
          <section key={title}>
            <h3>{title}</h3>
            <p>{text}</p>
          </section>
        ))}
      {postmortem.action_items && postmortem.action_items.length > 0 ? (
        <section>
          <h3>Follow-up actions</h3>
          <ul>
            {postmortem.action_items.map((item, index) => (
              <li key={index} className={item.done ? 'done' : undefined}>
                {item.title}
                {item.done ? ' (done)' : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  )
}

export default async function IncidentPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { org, slug, id } = await params
  const view = await statusRoute(org, slug, await searchParams, `/incidents/${id}`)
  if (view.kind === 'gate') return <PrivateGate stub={view.stub} location={view.location} appUrl={appUrl()} />
  if (!isUuid(id)) notFound()
  const payload = await view.reader.incident(id)
  if (!payload) notFound()
  const { incident } = payload
  const { page, location } = view
  const names = componentNameMap(page, incident.components)
  const duration = durationBetween(incident.started_at, incident.resolved_at)

  return (
    <StatusShell project={page.project} location={location} page={page} appUrl={appUrl()}>
      <main className="sp-wrap sp-main">
        <a className="sp-back" href={pageHref(location)}>
          <ChevronLeftIcon size={16} /> Current status
        </a>
        <article className="sp-card sp-detail" aria-labelledby="sp-incident-title">
          <h1 id="sp-incident-title">{incident.title}</h1>
          <ImpactChips incident={incident} />
          <div className="sp-detail-meta">
            <span>
              {incidentStatusLabel(incident.status)}
              {incident.status === 'resolved' && duration ? ` after ${duration}` : ''}
            </span>
            <span>
              Started <LocalTime value={incident.started_at} format="datetime-full-tz" />
            </span>
            {incident.resolved_at ? (
              <span>
                Resolved <LocalTime value={incident.resolved_at} format="end-tz" relativeTo={incident.started_at} />
              </span>
            ) : null}
          </div>
          <div>
            {incident.updates.map((update) => (
              <UpdateRow key={update.id} update={update} impact={incident.impact} names={names} />
            ))}
            {incident.updates.length === 0 ? <p className="sp-muted">No public updates yet.</p> : null}
          </div>
        </article>
        {incident.postmortem && incident.postmortem.published_at ? <Postmortem postmortem={incident.postmortem} /> : null}
      </main>
    </StatusShell>
  )
}
