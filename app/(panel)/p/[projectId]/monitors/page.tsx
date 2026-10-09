import type { Metadata } from 'next'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { redirect } from 'next/navigation'
import { hasRole, type MonitorState } from '@shared/domain.ts'
import { planLimit } from '@shared/plans.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { MonitorsList, type StateFilter } from '@/components/panel/monitors/MonitorsList'
import { ButtonLink } from '@/components/ui/Button'
import { PlugIcon } from '@/components/ui/icons'
import { getMonitorsOverview } from '@/lib/domain/monitors'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/monitors.css'

export const metadata: Metadata = { title: 'Monitors' }

const FILTERS: Record<StateFilter, MonitorState[] | undefined> = {
  all: undefined,
  down: ['down'],
  degraded: ['degraded'],
  up: ['up'],
  paused: ['paused'],
}

export default async function MonitorsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ state?: string; q?: string; new?: string }> }) {
  const { projectId } = await params
  const query = await searchParams
  if (query.new === '1') redirect(`/p/${projectId}/monitors/new`)
  const filter: StateFilter = query.state && query.state in FILTERS ? (query.state as StateFilter) : 'all'
  const search = (query.q ?? '').trim().slice(0, 120)
  const ctx = await panelContext()
  const { access, monitors, counts, regionStates, summaries } = await guard(() => getMonitorsOverview(ctx, projectId, { state: FILTERS[filter], search: search || undefined }))

  // Problems first, then the rest by name.
  const rank: Record<MonitorState, number> = { down: 0, degraded: 1, pending: 2, up: 3, paused: 4 }
  const sorted = [...monitors].sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name))
  const regionRows = Object.fromEntries(Object.entries(regionStates).map(([id, rows]) => [id, rows.map((row) => ({ region: row.region, confirmed: row.confirmed }))]))
  const summaryRows = Object.fromEntries(
    Object.entries(summaries).map(([id, summary]) => [id, { availability: summary.availability, p95_latency_ms: summary.p95_latency_ms, latency_buckets: summary.latency_buckets }]),
  )

  return (
    <>
      {/* Monitor runs are not streamed over Realtime (too frequent); poll while the page is open. */}
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Monitors"
        subtitle="Checks from several regions that set component status and open draft incidents when something breaks."
        actions={
          hasRole(access.role, 'admin') ? (
            <ButtonLink href={`/p/${access.project.id}/integrations`} icon={<PlugIcon size={14} />}>
              Integrations and heartbeats
            </ButtonLink>
          ) : null
        }
      />
      <MonitorsList
        projectId={access.project.id}
        monitors={sorted}
        counts={counts}
        regionStates={regionRows}
        summaries={summaryRows}
        filter={filter}
        search={search}
        canEdit={hasRole(access.role, 'admin')}
        canRun={hasRole(access.role, 'responder')}
        monitorLimit={planLimit(access.organization.plan, 'monitors')}
      />
    </>
  )
}
