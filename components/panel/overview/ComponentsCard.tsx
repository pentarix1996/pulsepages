'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { MONITOR_STATE_LABELS } from '@shared/domain.ts'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { PlusIcon } from '@/components/ui/icons'
import { Segmented } from '@/components/ui/Segmented'
import { StatusPill } from '@/components/ui/Status'
import { UptimeBars } from '@/components/ui/UptimeBars'
import { formatMs, formatUptime } from '@/lib/format'
import type { OverviewComponent, OverviewData } from '@/lib/domain/overview'

type Filter = 'all' | 'issues'

/** A p95 worth a second look: over a second, or twice the page-wide p95. */
function isSlow(p95: number | null, pageP95: number | null): boolean {
  if (p95 === null) return false
  return p95 >= 1000 || (pageP95 !== null && pageP95 > 0 && p95 >= pageP95 * 2 && p95 >= 300)
}

function MonitorSummary({ component }: { component: OverviewComponent }) {
  const monitors = component.monitors
  if (monitors.length === 0) return <span className="faint">{component.pinned ? 'Pinned by hand' : 'No monitor'}</span>
  const failing = monitors.filter((monitor) => monitor.state === 'down' || monitor.state === 'degraded')
  const first = failing[0] ?? monitors[0]!
  const title = monitors.map((monitor) => `${monitor.name}: ${MONITOR_STATE_LABELS[monitor.state]}`).join('\n')
  const tone = first.state === 'down' ? 's-major_outage' : first.state === 'degraded' ? 's-degraded' : ''
  return (
    <span className="ov-mon truncate" title={title}>
      <span className={tone}>{first.name}</span>
      {first.state === 'down' || first.state === 'degraded' ? <span className={tone}> {MONITOR_STATE_LABELS[first.state].toLowerCase()}</span> : null}
      {monitors.length > 1 ? <span className="faint"> +{monitors.length - 1}</span> : null}
    </span>
  )
}

function ComponentRow({ component, pageP95 }: { component: OverviewComponent; pageP95: number | null }) {
  const uptime = formatUptime(component.uptime)
  const slow = isSlow(component.p95_ms, pageP95)
  return (
    <div className="ov-tr" role="row">
      <span role="cell" className="c-name">
        <Link className="ov-name" href={component.href}>
          {component.name}
        </Link>
        <span className="c-sub">
          <MonitorSummary component={component} />
        </span>
      </span>
      <span role="cell" className="c-status">
        <StatusPill status={component.status} short />
      </span>
      <span role="cell" className="c-bars">
        {component.days.length > 0 ? <UptimeBars days={component.days} label={`${component.name}, last ${component.days.length} days`} uptime={uptime} /> : <span className="faint">No history yet</span>}
      </span>
      <span role="cell" className="c-uptime num">
        {uptime}
      </span>
      <span role="cell" className={['c-p95 mono num', slow ? 's-degraded' : ''].join(' ')} title={slow ? 'Slower than usual (p95 over the last 24 hours)' : 'p95 over the last 24 hours'}>
        {formatMs(component.p95_ms)}
      </span>
      <span role="cell" className="c-mon">
        <MonitorSummary component={component} />
      </span>
      <span className="c-meta" aria-hidden="true">
        <span className="num">{uptime} uptime</span>
        <span className={['mono num', slow ? 's-degraded' : ''].join(' ')}>p95 {formatMs(component.p95_ms)}</span>
      </span>
    </div>
  )
}

export function ComponentsCard({ data, canAdmin }: { data: OverviewData; canAdmin: boolean }) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const filter: Filter = searchParams.get('components') === 'issues' ? 'issues' : 'all'
  const base = `/p/${data.project.id}`
  const all = data.groups.flatMap((group) => group.components)
  const withIssues = all.filter((component) => component.status !== 'operational')
  const groups = data.groups
    .map((group) => ({ ...group, components: filter === 'issues' ? group.components.filter((component) => component.status !== 'operational') : group.components }))
    .filter((group) => group.components.length > 0)

  const setFilter = (value: Filter) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete('components')
    else params.set('components', value)
    const query = params.toString()
    // The data is already here: update the URL without a server round trip (Next syncs useSearchParams).
    window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname)
  }

  return (
    <Card className="ov-comp" aria-label="Components">
      <CardHeader
        title="Components"
        actions={
          all.length > 0 ? (
            <Segmented<Filter>
              label="Filter components"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'issues', label: `With issues (${withIssues.length})` },
              ]}
            />
          ) : null
        }
      />
      {all.length === 0 ? (
        <EmptyState
          title="No components yet"
          description="Components are what customers see on the status page, such as API, Dashboard or Webhooks. Link monitors to them and their status updates on its own."
          action={
            canAdmin ? (
              <ButtonLink variant="primary" icon={<PlusIcon size={14} />} href={`${base}/components?new=1`}>
                Add component
              </ButtonLink>
            ) : null
          }
        />
      ) : groups.length === 0 ? (
        <div className="ov-filter-empty">
          <StatusPill status="operational">Every component is operational right now.</StatusPill>
        </div>
      ) : (
        <div className="ov-table" role="table" aria-label="Components">
          <div className="ov-tr th" role="row">
            <span role="columnheader" className="c-name">
              Component
            </span>
            <span role="columnheader" className="c-status">
              Status
            </span>
            <span role="columnheader" className="c-bars">
              Last 90 days
            </span>
            <span role="columnheader" className="c-uptime">
              Uptime
            </span>
            <span role="columnheader" className="c-p95">
              p95
            </span>
            <span role="columnheader" className="c-mon">
              Monitor
            </span>
          </div>
          {groups.map((group) => (
            <div role="rowgroup" key={group.id ?? 'ungrouped'}>
              {group.name ? (
                <div className="ov-group" role="row">
                  <span role="cell">{group.name}</span>
                </div>
              ) : null}
              {group.components.map((component) => (
                <ComponentRow key={component.id} component={component} pageP95={data.kpis.latency.p95_ms} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
