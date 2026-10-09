// Server-rendered blocks of the public status page (StatusPage and StatusMobile mockups).
import { COMPONENT_STATUS_LABELS, type ComponentStatus } from '@shared/domain.ts'
import { AlertCircleIcon, CheckCircleIcon, WrenchIcon } from '@/components/ui/icons'
import { UptimeBars } from '@/components/ui/UptimeBars'
import { formatUptime } from '@/lib/format'
import { PAGE_PATHS, pageHref, type PageLocation } from '@/lib/status-page/links'
import { formatDayKey } from '@/lib/status-page/time'
import type { StatusComponent, StatusIncident, StatusIncidentUpdate, StatusMaintenance, StatusPageData } from '@/lib/status-page/types'
import {
  componentSections,
  componentStatusLabel,
  durationBetween,
  IMPACT_LABELS,
  IMPACT_TONE,
  incidentStatusLabel,
  maintenanceStatusLabel,
  overallSummary,
  pastDays,
  updateComponentChanges,
  updateTone,
  windowUptime,
} from '@/lib/status-page/view'
import { CollapsibleGroup } from '../Collapsible'
import { LocalTime } from '../LocalTime'
import { InfoTip } from './StatusShell'

const TONE_CLASS: Record<ComponentStatus | 'none', string> = {
  operational: 's-operational',
  degraded: 's-degraded',
  partial_outage: 's-partial_outage',
  major_outage: 's-major_outage',
  maintenance: 's-maintenance',
  none: '',
}

// ------------------------------------------------------------------ overall
export function OverallBanner({ page }: { page: StatusPageData }) {
  const summary = overallSummary(page)
  const Icon = summary.status === 'operational' ? CheckCircleIcon : summary.status === 'maintenance' ? WrenchIcon : AlertCircleIcon
  return (
    <section className={`sp-overall is-${summary.status}`} aria-label="Current status" aria-live="polite">
      <span className="sp-ov-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={2.4} />
      </span>
      <div className="sp-ov-text">
        <h1>{summary.headline}</h1>
        <p>{summary.detail}</p>
      </div>
      <span className="sp-ov-updated">
        Updated <LocalTime value={page.generated_at} format="time-tz" />
      </span>
    </section>
  )
}

// ------------------------------------------------------------------ incidents
export function UpdateRow({ update, impact, names }: { update: StatusIncidentUpdate; impact: StatusIncident['impact']; names?: Map<string, string> }) {
  const tone = updateTone(update, impact)
  const changes = names ? updateComponentChanges(update, names) : []
  return (
    <div className="sp-upd">
      <div className="sp-upd-meta">
        <strong className={TONE_CLASS[tone]}>{incidentStatusLabel(update.status)}</strong>
        <LocalTime value={update.created_at} format="datetime" />
      </div>
      <div className="sp-upd-body">
        <p>{update.message}</p>
        {changes.length > 0 ? (
          <span className="sp-upd-changes">
            {changes.map((change) => (
              <span key={change.id}>
                {change.name}: <span className={TONE_CLASS[change.status]}>{COMPONENT_STATUS_LABELS[change.status]}</span>
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function ImpactChips({ incident }: { incident: StatusIncident }) {
  return (
    <div className="sp-chips">
      <span className={`sp-chip ${TONE_CLASS[IMPACT_TONE[incident.impact]]}`}>{IMPACT_LABELS[incident.impact]}</span>
      {incident.components.map((component) => (
        <span key={component.id} className="sp-chip">
          {component.name}
        </span>
      ))}
    </div>
  )
}

/** Active incident with its latest public update; the permalink has the full timeline. */
export function ActiveIncident({ incident, location }: { incident: StatusIncident; location: PageLocation }) {
  const href = pageHref(location, PAGE_PATHS.incident(incident.id))
  const latest = incident.updates[0] ?? null
  return (
    <section className="sp-card sp-incident" aria-label={`Incident: ${incident.title}`}>
      <div className="sp-inc-head">
        <div className="sp-inc-title">
          <h2>
            <a href={href}>{incident.title}</a>
          </h2>
          <ImpactChips incident={incident} />
        </div>
        <a className="sp-follow" href={href}>
          Full timeline
        </a>
      </div>
      {latest ? (
        <UpdateRow update={latest} impact={incident.impact} />
      ) : (
        <div className="sp-upd">
          <div className="sp-upd-meta">
            <strong className={TONE_CLASS[IMPACT_TONE[incident.impact]]}>{incidentStatusLabel(incident.status)}</strong>
            <LocalTime value={incident.started_at} format="datetime" />
          </div>
          <p className="sp-muted">We are looking into it. The next update will appear here.</p>
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------------ maintenance
export function MaintenanceCard({ maintenance, location }: { maintenance: StatusMaintenance; location: PageLocation }) {
  const href = pageHref(location, PAGE_PATHS.maintenance(maintenance.id))
  const live = maintenance.status === 'in_progress'
  const start = maintenance.actual_start ?? maintenance.scheduled_start
  return (
    <section className={['sp-card', 'sp-maint', live ? 'is-live' : ''].join(' ')} aria-label={`Maintenance: ${maintenance.title}`}>
      <span className="sp-date-tile" aria-hidden="true">
        <span>
          <LocalTime value={start} format="dow" />
        </span>
        <strong>
          <LocalTime value={start} format="day" />
        </strong>
      </span>
      <div className="sp-maint-body">
        <div className="sp-maint-title">
          <h2>
            <a href={href}>{maintenance.title}</a>
          </h2>
          <span className="sp-chip s-maintenance">{maintenanceStatusLabel(maintenance.status)}</span>
        </div>
        <p>
          <span className="sp-maint-when">
            <LocalTime value={start} format="datetime" /> to <LocalTime value={maintenance.scheduled_end} format="end-tz" relativeTo={start} />
          </span>
          {maintenance.description ? `. ${maintenance.description}` : '.'}
        </p>
        {maintenance.components.length > 0 ? <span className="sp-faint">Affects {maintenance.components.map((component) => component.name).join(', ')}</span> : null}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ components
function ComponentRow({ component, barDays, loose }: { component: StatusComponent; barDays: number; loose: boolean }) {
  const shortDays = Math.min(30, component.days.length)
  const shortUptime = windowUptime(component.days, shortDays)
  return (
    <div className={['sp-crow', loose ? 'loose' : ''].join(' ')}>
      <div className="sp-crow-top">
        <span className="sp-crow-name">
          {component.name}
          {component.description ? <InfoTip text={component.description} /> : null}
        </span>
        <span className={`sp-st ${TONE_CLASS[component.status]}`}>{componentStatusLabel(component.status)}</span>
      </div>
      {component.days.length > 0 ? (
        <>
          <div className="sp-bars-long">
            <UptimeBars days={component.days} label={`${component.name}, last ${barDays} days`} size="lg" showLegend uptime={formatUptime(component.uptime)} />
          </div>
          <div className="sp-bars-short">
            <UptimeBars days={component.days.slice(-shortDays)} label={`${component.name}, last ${shortDays} days`} size="lg" showLegend uptime={formatUptime(shortUptime)} />
          </div>
        </>
      ) : null}
    </div>
  )
}

export function ComponentsCard({ page }: { page: StatusPageData }) {
  const sections = componentSections(page)
  const barDays = page.project.bar_days || 90
  if (sections.length === 0) return null
  return (
    <section className="sp-card sp-components" aria-label="Components">
      <div className="sp-card-head">
        <h2>Components</h2>
        <span className="sp-faint">
          <span className="sp-bars-long">Uptime over the last {barDays} days. Hover a day for details.</span>
          <span className="sp-bars-short">Uptime over the last 30 days.</span>
        </span>
      </div>
      {sections.map((section) =>
        section.group ? (
          <CollapsibleGroup
            key={section.group.id}
            name={section.group.name}
            status={section.status}
            statusLabel={componentStatusLabel(section.status)}
            defaultOpen={!section.group.collapsed || section.status !== 'operational'}
          >
            {section.components.map((component) => (
              <ComponentRow key={component.id} component={component} barDays={barDays} loose={false} />
            ))}
          </CollapsibleGroup>
        ) : (
          <div key="loose" className="sp-group">
            {section.components.map((component) => (
              <ComponentRow key={component.id} component={component} barDays={barDays} loose />
            ))}
          </div>
        ),
      )}
    </section>
  )
}

// ------------------------------------------------------------------ past days and history items
export function IncidentSummary({ incident, location, ongoing }: { incident: StatusIncident; location: PageLocation; ongoing: boolean }) {
  const latest = incident.updates[0]
  const duration = durationBetween(incident.started_at, incident.resolved_at)
  return (
    <div className="sp-day-item">
      <a href={pageHref(location, PAGE_PATHS.incident(incident.id))}>{incident.title}</a>
      {latest ? <p>{latest.message}</p> : null}
      <span className="sp-day-meta">
        {ongoing ? `${incidentStatusLabel(incident.status)}, ongoing` : duration ? `Resolved after ${duration}` : incidentStatusLabel(incident.status)}
        {', '}
        <span className={TONE_CLASS[IMPACT_TONE[incident.impact]]}>{IMPACT_LABELS[incident.impact].toLowerCase()}</span>
        {', started '}
        <LocalTime value={incident.started_at} format="time-tz" />
      </span>
    </div>
  )
}

export function MaintenanceSummary({ maintenance, location }: { maintenance: StatusMaintenance; location: PageLocation }) {
  // A cancelled window never ran: show what was planned.
  const cancelled = maintenance.status === 'cancelled'
  const start = cancelled ? maintenance.scheduled_start : (maintenance.actual_start ?? maintenance.scheduled_start)
  const end = cancelled ? maintenance.scheduled_end : (maintenance.actual_end ?? maintenance.scheduled_end)
  return (
    <div className="sp-day-item">
      <a href={pageHref(location, PAGE_PATHS.maintenance(maintenance.id))}>{maintenance.title}</a>
      {maintenance.updates[0]?.message || maintenance.description ? <p>{maintenance.updates[0]?.message || maintenance.description}</p> : null}
      <span className="sp-day-meta">
        <span className="s-maintenance">{maintenanceStatusLabel(maintenance.status)}</span>, <LocalTime value={start} format="time" /> to <LocalTime value={end} format="end-tz" relativeTo={start} />
      </span>
    </div>
  )
}

export function PastDaysCard({ page, location }: { page: StatusPageData; location: PageLocation }) {
  const days = pastDays(page, page.project.timezone)
  return (
    <section className="sp-card sp-past" aria-label="Past 7 days">
      <div className="sp-card-head">
        <h2>Past 7 days</h2>
        <a href={pageHref(location, PAGE_PATHS.history)} style={{ fontSize: 14, fontWeight: 600 }}>
          Incident history
        </a>
      </div>
      {days.map((day, index) => (
        <div className="sp-day" key={day.key}>
          <span className="sp-day-label">{index === 0 ? 'Today' : index === 1 ? 'Yesterday' : formatDayKey(day.key)}</span>
          <div className="sp-day-items">
            {day.entries.length === 0 ? <span className="sp-day-empty">No incidents reported.</span> : null}
            {day.entries.map((entry) =>
              entry.kind === 'incident' ? (
                <IncidentSummary key={`i-${entry.incident.id}`} incident={entry.incident} location={location} ongoing={entry.ongoing} />
              ) : (
                <MaintenanceSummary key={`m-${entry.maintenance.id}`} maintenance={entry.maintenance} location={location} />
              ),
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
