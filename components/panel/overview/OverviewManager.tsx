'use client'

import { hasRole, impactRank, INCIDENT_IMPACT_LABELS, INCIDENT_STATUS_LABELS } from '@shared/domain.ts'
import { ButtonLink } from '@/components/ui/Button'
import { Kpi, Meter } from '@/components/ui/Card'
import { Sparkline } from '@/components/ui/Charts'
import { ExternalLinkIcon } from '@/components/ui/icons'
import { Chip, ImpactChip, StatusDot } from '@/components/ui/Status'
import { Elapsed, RelativeTime } from '@/components/ui/Time'
import { PageHeader } from '@/components/panel/PageHeader'
import { formatDuration, formatMs, formatUptime } from '@/lib/format'
import type { OverviewData, OverviewIncident, OverviewMaintenance } from '@/lib/domain/overview'
import { ComponentsCard } from './ComponentsCard'
import { clockTime, everyInterval, shortMoment, timeRange } from './format'
import { SetupChecklist } from './SetupChecklist'
import { LiveChecks, StatusPageCard, UpcomingMaintenance } from './SideCards'

export function OverviewManager({ data }: { data: OverviewData }) {
  const canRespond = hasRole(data.role, 'responder')
  const canAdmin = hasRole(data.role, 'admin')
  const base = `/p/${data.project.id}`
  const timeZone = data.project.timezone
  const now = new Date(data.generated_at)
  const interval = data.kpis.monitors.min_interval_seconds

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          interval ? (
            <>
              <StatusDot status="operational" pulse />
              Live. Checks arrive {everyInterval(interval)}.
            </>
          ) : (
            <>
              <StatusDot status="none" />
              No monitors running. Status comes from incidents, maintenance and pinned statuses.
            </>
          )
        }
        actions={
          canRespond ? (
            <>
              <ButtonLink href={`${base}/maintenance?new=1`}>Schedule maintenance</ButtonLink>
              <ButtonLink variant="primary" href={`${base}/incidents?new=1`}>
                Declare incident
              </ButtonLink>
            </>
          ) : (
            <ButtonLink href={data.project.status_page_url} target="_blank" rel="noreferrer" icon={<ExternalLinkIcon size={14} />}>
              View public page
            </ButtonLink>
          )
        }
      />

      {data.checklist ? <SetupChecklist projectId={data.project.id} checklist={data.checklist} statusPageUrl={data.project.status_page_url} /> : null}

      {data.incidents.map((incident) => (
        <IncidentBanner key={incident.id} incident={incident} base={base} timeZone={timeZone} canRespond={canRespond} />
      ))}

      {data.drafts.slice(0, 3).map((draft) => (
        <section key={draft.id} className="ov-draft" aria-label="Draft incident">
          <span className="tag tag-internal">Draft</span>
          <span className="grow">
            <strong>{draft.title}</strong>
            <span className="muted">
              {' '}
              opened {draft.source === 'monitor' ? 'by a monitor' : draft.source === 'signal' ? 'by an external alert' : ''} <RelativeTime value={draft.detected_at} />. Only your team can see it until it is published.
            </span>
          </span>
          <ButtonLink size="sm" href={`${base}/incidents/${draft.id}`}>
            Review draft
          </ButtonLink>
        </section>
      ))}

      {data.maintenance.in_progress.map((maintenance) => (
        <MaintenanceBanner key={maintenance.id} maintenance={maintenance} base={base} timeZone={timeZone} />
      ))}

      <KpiStrip data={data} now={now} canAdmin={canAdmin} />

      <div className="columns ov-columns">
        <div className="col-main">
          <ComponentsCard data={data} canAdmin={canAdmin} />
        </div>
        <div className="col-side">
          <LiveChecks data={data} canAdmin={canAdmin} />
          <UpcomingMaintenance data={data} canRespond={canRespond} />
          <StatusPageCard data={data} canAdmin={canAdmin} />
        </div>
      </div>
    </>
  )
}

function IncidentBanner({ incident, base, timeZone, canRespond }: { incident: OverviewIncident; base: string; timeZone: string; canRespond: boolean }) {
  const severe = impactRank(incident.impact) >= 2
  const update = incident.latest_update
  return (
    <section className={['incident-banner', 'ov-incident', severe ? '' : 'minor'].filter(Boolean).join(' ')} aria-label={`Active incident: ${incident.title}`}>
      <StatusDot status={severe ? 'major_outage' : 'degraded'} pulse large />
      <div className="grow stack" style={{ ['--gap' as string]: '6px' }}>
        <div className="row-wrap" style={{ ['--gap' as string]: '10px' }}>
          <strong className="ov-incident-title">{incident.title}</strong>
          <ImpactChip impact={incident.impact} />
          <Chip>{INCIDENT_STATUS_LABELS[incident.status]}</Chip>
          <Chip className="mono num" title="Time since the incident was detected">
            <Elapsed since={incident.detected_at} />
          </Chip>
        </div>
        <p className="ov-incident-update">
          {update ? (
            <>
              <span className="mono num">{clockTime(update.created_at, timeZone)}</span> update: {update.message}
            </>
          ) : (
            'No public update yet. Customers only see the title and the affected components.'
          )}
        </p>
        {incident.components.length > 0 ? <span className="ov-incident-components">Affects {incident.components.join(', ')}</span> : null}
      </div>
      <div className="row-wrap">
        {canRespond ? <ButtonLink href={`${base}/incidents/${incident.id}#composer`}>Post update</ButtonLink> : null}
        <ButtonLink variant="primary" href={`${base}/incidents/${incident.id}`}>
          Open incident
        </ButtonLink>
      </div>
    </section>
  )
}

function MaintenanceBanner({ maintenance, base, timeZone }: { maintenance: OverviewMaintenance; base: string; timeZone: string }) {
  return (
    <section className="incident-banner maint" aria-label={`Maintenance in progress: ${maintenance.title}`}>
      <StatusDot status="maintenance" large />
      <div className="grow stack" style={{ ['--gap' as string]: '6px' }}>
        <div className="row-wrap" style={{ ['--gap' as string]: '10px' }}>
          <strong className="ov-incident-title">{maintenance.title}</strong>
          <Chip tone="info">Maintenance in progress</Chip>
          {maintenance.actual_start ? (
            <Chip className="mono num" title="Time since the window started">
              <Elapsed since={maintenance.actual_start} />
            </Chip>
          ) : null}
        </div>
        <p className="ov-incident-update">
          {timeRange(maintenance.actual_start ?? maintenance.scheduled_start, maintenance.scheduled_end, timeZone)}
          {maintenance.components.length > 0 ? `. ${maintenance.components.join(', ')} ${maintenance.components.length === 1 ? 'shows' : 'show'} as under maintenance.` : '.'}
          {maintenance.mute_alerts ? ' Alerts for these components are muted.' : ''}
        </p>
      </div>
      <ButtonLink href={`${base}/maintenance/${maintenance.id}`}>Open maintenance</ButtonLink>
    </section>
  )
}

function KpiStrip({ data, now, canAdmin }: { data: OverviewData; now: Date; canAdmin: boolean }) {
  const { kpis } = data
  const timeZone = data.project.timezone
  const base = `/p/${data.project.id}`
  const slo = kpis.slo
  const budget = slo ? Math.round(slo.budget_remaining * 100) : null
  const mttr = kpis.mttr
  const failing = kpis.monitors.failing

  let mttrNote: string
  if (mttr.current === null) mttrNote = 'No incidents resolved in the last 30 days'
  else if (mttr.previous === null) mttrNote = `${mttr.resolved} resolved; nothing to compare with the 30 days before`
  else {
    const delta = mttr.current - mttr.previous
    mttrNote = Math.abs(delta) < 60 ? 'About the same as the previous 30 days' : `${formatDuration(Math.abs(delta))} ${delta < 0 ? 'faster' : 'slower'} than the previous 30 days`
  }

  let monitorsNote: string
  if (kpis.monitors.total === 0) monitorsNote = kpis.monitors.paused > 0 ? `${kpis.monitors.paused} paused` : 'No monitors yet'
  else if (failing.length > 0) {
    const names = failing.slice(0, 2).map((monitor) => monitor.name)
    monitorsNote = `${names.join(', ')}${failing.length > 2 ? ` and ${failing.length - 2} more` : ''} failing`
  } else if (kpis.monitors.pending > 0) monitorsNote = `${kpis.monitors.pending} waiting for a first check`
  else monitorsNote = kpis.monitors.paused > 0 ? `All passing, ${kpis.monitors.paused} paused` : 'All passing'

  const open = kpis.open_incidents
  return (
    <section className="card kpis ov-kpis" aria-label="Key numbers">
      <Kpi
        label="Uptime, last 30 days"
        value={formatUptime(kpis.uptime)}
        note={
          slo && budget !== null ? (
            budget > 0 ? (
              `${budget}% of the ${slo.target}% SLO error budget left`
            ) : (
              <span className="s-major_outage">Error budget of the {slo.target}% SLO used up</span>
            )
          ) : canAdmin ? (
            <a className="link" href={`${base}/reports#slos`}>
              Set an SLO to track an error budget
            </a>
          ) : (
            'No SLO set'
          )
        }
      >
        {slo && budget !== null ? <Meter value={budget} tone={budget > 50 ? 'ok' : budget > 20 ? 'warn' : 'bad'} label={`${budget}% of the error budget left`} /> : null}
      </Kpi>
      <Kpi
        label="Open incidents"
        value={<span className={open.count > 0 && open.worst_impact && impactRank(open.worst_impact) >= 2 ? 's-major_outage' : undefined}>{open.count}</span>}
        note={open.count > 0 && open.oldest_started_at ? `${open.worst_impact ? INCIDENT_IMPACT_LABELS[open.worst_impact] : 'Minor'} impact, started ${shortMoment(open.oldest_started_at, timeZone, now)}` : 'None right now'}
      />
      <Kpi label="Mean time to resolve" value={formatDuration(mttr.current, { compact: true })} note={mttrNote} />
      <Kpi
        label="Monitors passing"
        value={
          kpis.monitors.total > 0 ? (
            <>
              {kpis.monitors.passing}
              <span className="ov-kpi-of"> / {kpis.monitors.total}</span>
            </>
          ) : (
            '—'
          )
        }
        note={failing.length > 0 ? <span className="s-degraded">{monitorsNote}</span> : monitorsNote}
      />
      <Kpi label="p95 response time" value={formatMs(kpis.latency.p95_ms)} note={kpis.latency.checks > 0 ? (kpis.latency.rising ? <span className="s-degraded">Rising over the last hours</span> : `Last 24 hours, ${kpis.latency.checks.toLocaleString('en-US')} checks`) : 'No checks in the last 24 hours'}>
        {kpis.latency.sparkline.length >= 2 ? <Sparkline values={kpis.latency.sparkline} color={kpis.latency.rising ? 'var(--deg)' : 'var(--accent)'} label="p95 response time per hour over the last 24 hours" /> : null}
      </Kpi>
    </section>
  )
}
