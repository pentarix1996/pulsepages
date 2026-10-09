// Server-rendered report blocks shared by /reports and the printable SLA report.
import Link from 'next/link'
import { INCIDENT_IMPACT_LABELS, INCIDENT_STATUS_LABELS, type IncidentImpact } from '@shared/domain.ts'
import { Kpi } from '@/components/ui/Card'
import { ImpactChip, StatusPill } from '@/components/ui/Status'
import { incidentTimings } from '@/lib/domain/metrics'
import type { ProjectMetrics } from '@/lib/domain/types'
import { formatDateTime, formatDuration, formatUptime } from '@/lib/format'

export function ReportKpis({ metrics, sloTarget }: { metrics: ProjectMetrics; sloTarget: number | null }) {
  const impacts = (['critical', 'major', 'minor', 'none'] as IncidentImpact[]).filter((impact) => (metrics.incidents.by_impact[impact] ?? 0) > 0)
  return (
    <section className="card kpis" aria-label="Summary">
      <Kpi
        label="Uptime"
        value={<span className={sloTarget !== null && metrics.uptime < sloTarget ? 's-major' : undefined}>{formatUptime(metrics.uptime)}</span>}
        note={sloTarget !== null ? (metrics.uptime >= sloTarget ? `Meets the ${sloTarget}% target` : `Below the ${sloTarget}% target`) : 'Weighted by outage severity'}
      />
      <Kpi
        label="Incidents"
        value={metrics.incidents.total}
        note={impacts.length === 0 ? 'None in this period' : impacts.map((impact) => `${metrics.incidents.by_impact[impact]} ${INCIDENT_IMPACT_LABELS[impact].toLowerCase()}`).join(', ')}
      />
      <Kpi label="Mean time to acknowledge" value={formatDuration(metrics.incidents.mtta_seconds, { compact: true })} note="Detection to first response" />
      <Kpi label="Mean time to resolve" value={formatDuration(metrics.incidents.mttr_seconds, { compact: true })} note="Detection to resolution" />
      <Kpi label="Longest incident" value={formatDuration(metrics.incidents.longest_seconds, { compact: true })} note="Detection to resolution" />
    </section>
  )
}

export function UptimeTable({ metrics }: { metrics: ProjectMetrics }) {
  if (metrics.components.length === 0) return <p className="rp-empty">No components in this period.</p>
  return (
    <div className="tbl-scroll">
      <div className="tbl" role="table" aria-label="Uptime by component" style={{ ['--cols' as string]: 'minmax(180px, 1.4fr) minmax(130px, 1fr) 90px repeat(4, minmax(90px, 0.8fr))', minWidth: 900 }}>
        <div className="tr th" role="row">
          <span role="columnheader">Component</span>
          <span role="columnheader">Now</span>
          <span role="columnheader">Uptime</span>
          <span role="columnheader">Major outage</span>
          <span role="columnheader">Partial outage</span>
          <span role="columnheader">Degraded</span>
          <span role="columnheader">Maintenance</span>
        </div>
        {metrics.components.map((component) => (
          <div className="tr" role="row" key={component.id}>
            <span role="cell" style={{ fontWeight: 550 }}>
              {component.name}
            </span>
            <span role="cell">
              <StatusPill status={component.status} short />
            </span>
            <span role="cell" className="num" style={{ fontWeight: 600 }}>
              {formatUptime(component.uptime)}
            </span>
            <span role="cell" className={['num', component.major_seconds > 0 ? 's-major' : 'faint'].join(' ')}>
              {component.major_seconds > 0 ? formatDuration(component.major_seconds) : '—'}
            </span>
            <span role="cell" className={['num', component.partial_seconds > 0 ? 's-part' : 'faint'].join(' ')}>
              {component.partial_seconds > 0 ? formatDuration(component.partial_seconds) : '—'}
            </span>
            <span role="cell" className={['num', component.degraded_seconds > 0 ? 's-degraded' : 'faint'].join(' ')}>
              {component.degraded_seconds > 0 ? formatDuration(component.degraded_seconds) : '—'}
            </span>
            <span role="cell" className={['num', component.maintenance_seconds > 0 ? 's-maintenance' : 'faint'].join(' ')}>
              {component.maintenance_seconds > 0 ? formatDuration(component.maintenance_seconds) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function IncidentTable({ metrics, publishedAt, timeZone, projectId }: { metrics: ProjectMetrics; publishedAt: Record<string, string | null>; timeZone: string; projectId: string | null }) {
  if (metrics.incidents.list.length === 0) return <p className="rp-empty">No incidents in this period.</p>
  return (
    <div className="tbl-scroll">
      <div className="tbl" role="table" aria-label="Incidents" style={{ ['--cols' as string]: 'minmax(220px, 2fr) 120px minmax(120px, 1fr) minmax(130px, 1fr) 100px 100px 110px', minWidth: 980 }}>
        <div className="tr th" role="row">
          <span role="columnheader">Incident</span>
          <span role="columnheader">Impact</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Detected</span>
          <span role="columnheader">Acknowledged</span>
          <span role="columnheader">Resolved</span>
          <span role="columnheader">Customers saw it</span>
        </div>
        {metrics.incidents.list.map((incident) => {
          const timings = incidentTimings(incident, publishedAt[incident.id] ?? null, metrics.to)
          return (
            <div className="tr" role="row" key={incident.id}>
              <span role="cell" style={{ fontWeight: 550, overflowWrap: 'anywhere' }}>
                {projectId ? (
                  <Link className="rowlink" href={`/p/${projectId}/incidents/${incident.id}`}>
                    {incident.title}
                  </Link>
                ) : (
                  incident.title
                )}
              </span>
              <span role="cell">
                <ImpactChip impact={incident.impact} />
              </span>
              <span role="cell" style={{ fontSize: 13 }}>
                {INCIDENT_STATUS_LABELS[incident.status]}
              </span>
              <span role="cell" className="num" style={{ fontSize: 13 }}>
                {formatDateTime(incident.detected_at, { timeZone })}
              </span>
              <span role="cell" className="num" style={{ fontSize: 13 }}>
                {timings.acknowledge_seconds === null ? '—' : `after ${formatDuration(timings.acknowledge_seconds, { compact: true })}`}
              </span>
              <span role="cell" className="num" style={{ fontSize: 13 }}>
                {timings.resolve_seconds === null ? 'Open' : `after ${formatDuration(timings.resolve_seconds, { compact: true })}`}
              </span>
              <span role="cell" className="num" style={{ fontSize: 13 }}>
                {publishedAt[incident.id] || incident.status !== 'draft' ? formatDuration(timings.duration_seconds, { compact: true }) : 'Never public'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
