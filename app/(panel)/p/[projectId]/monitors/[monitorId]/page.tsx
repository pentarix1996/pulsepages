import type { Metadata } from 'next'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { hasRole } from '@shared/domain.ts'
import { MonitorHeader } from '@/components/panel/monitors/MonitorHeader'
import { AlertRoutingCard, HeartbeatCard, MonitorConfigCard, RegionTiles } from '@/components/panel/monitors/MonitorPanels'
import { RecentChecks } from '@/components/panel/monitors/RecentChecks'
import { ResponseTimeCard } from '@/components/panel/monitors/ResponseTimeCard'
import { getMonitorDetail } from '@/lib/domain/monitors'
import { decodeCursor, type Cursor } from '@/lib/domain/pagination'
import { RESULT_STATUS_FILTERS } from '@/lib/domain/schemas/monitors'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/monitors.css'

export const metadata: Metadata = { title: 'Monitor' }

type SearchParams = { range?: string; region?: string; status?: string; cursor?: string }

function safeCursor(value: string | undefined): Cursor | null {
  try {
    return decodeCursor(value)
  } catch {
    return null
  }
}

export default async function MonitorPage({ params, searchParams }: { params: Promise<{ projectId: string; monitorId: string }>; searchParams: Promise<SearchParams> }) {
  const { projectId, monitorId } = await params
  const query = await searchParams
  const range = query.range === '7d' ? '7d' : '24h'
  const status = (RESULT_STATUS_FILTERS as readonly string[]).includes(query.status ?? '') ? (query.status as (typeof RESULT_STATUS_FILTERS)[number]) : undefined
  const region = query.region && /^[a-z0-9-]{2,40}$/.test(query.region) ? query.region : undefined
  const cursor = safeCursor(query.cursor)
  const ctx = await panelContext()
  const detail = await guard(() => getMonitorDetail(ctx, projectId, monitorId, { range, checks: { region, status }, checksPage: { limit: 25, cursor } }))
  const { access, monitor } = detail
  const projectRef = access.project.id
  const threshold = Number((monitor.config as Record<string, unknown>).latency_threshold_ms) || null
  const isHeartbeat = monitor.type === 'heartbeat'

  return (
    <>
      {/* Monitor runs are not streamed over Realtime (too frequent); poll while the page is open. */}
      <AutoRefresh seconds={30} />
      <MonitorHeader projectId={projectRef} monitor={monitor} canEdit={hasRole(access.role, 'admin')} canRun={hasRole(access.role, 'responder')} />
      {isHeartbeat ? (
        <HeartbeatCard monitor={monitor} />
      ) : (
        <>
          <ResponseTimeCard range={detail.chart.range} from={detail.chart.from} to={detail.chart.to} buckets={detail.chart.buckets} regions={monitor.regions} threshold={threshold} />
          <RegionTiles monitor={monitor} regionStates={detail.regionStates} series={detail.series24h} />
        </>
      )}
      <div className="columns">
        <MonitorConfigCard monitor={monitor} componentStatuses={detail.componentStatuses} projectId={projectRef} />
        <AlertRoutingCard routing={detail.routing} projectId={projectRef} />
      </div>
      <RecentChecks
        checks={detail.checks.items}
        nextCursor={detail.checks.nextCursor}
        isFirstPage={cursor === null}
        regions={isHeartbeat ? [] : monitor.regions}
        region={region ?? null}
        status={status ?? null}
        timeZone={access.project.timezone || 'UTC'}
        threshold={threshold}
      />
    </>
  )
}
