import type { Metadata } from 'next'
import { AutoRefresh } from '@/components/status/AutoRefresh'
import { ActiveIncident, ComponentsCard, MaintenanceCard, OverallBanner, PastDaysCard } from '@/components/status/page/Sections'
import { PrivateGate } from '@/components/status/page/PrivateGate'
import { StatusShell, subscribeOptions } from '@/components/status/page/StatusShell'
import { SubscribeCard } from '@/components/status/Subscribe'
import { publicApiPath } from '@/lib/status-page/links'
import { overallSummary } from '@/lib/status-page/view'
import { appUrl, statusRoute, titleFor } from './_view'
import '@/styles/status.css'

type Params = { org: string; slug: string }
type Search = Record<string, string | string[] | undefined>

const NOTICES: Record<string, string> = {
  confirmation_sent: 'Check your inbox to confirm your subscription.',
  already_subscribed: 'You are already subscribed to updates.',
  subscribed: 'Subscribed. Updates will arrive with the next incident.',
  error: 'We could not save that subscription. Check the address and try again, or follow the RSS feed.',
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { org, slug } = await params
  return titleFor(org, slug)
}

export default async function StatusPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { org, slug } = await params
  const query = await searchParams
  const view = await statusRoute(org, slug, query, '/')
  const base = appUrl()

  if (view.kind === 'gate') {
    return <PrivateGate stub={view.stub} location={view.location} appUrl={base} notice={query.access === 'invalid' ? 'That access link does not work anymore. Ask for a new one.' : null} />
  }

  const { page, location } = view
  const summary = overallSummary(page)
  const notice = typeof query.subscribe === 'string' ? (NOTICES[query.subscribe] ?? null) : null
  const ongoing = page.active_incidents.length > 0 || summary.status !== 'operational'

  return (
    <StatusShell project={page.project} location={location} page={page} appUrl={base}>
      <main className="sp-wrap sp-main">
        <OverallBanner page={page} />
        {page.active_incidents.map((incident) => (
          <ActiveIncident key={incident.id} incident={incident} location={location} />
        ))}
        {page.maintenances.map((maintenance) => (
          <MaintenanceCard key={maintenance.id} maintenance={maintenance} location={location} />
        ))}
        <ComponentsCard page={page} />
        <PastDaysCard page={page} location={location} />
        <SubscribeCard endpoint={publicApiPath(location, 'subscribe')} components={subscribeOptions(page)} hasFeeds notice={notice} />
      </main>
      <AutoRefresh seconds={ongoing ? 30 : 120} />
    </StatusShell>
  )
}
