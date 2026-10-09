'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/panel/PageHeader'
import type { PickableComponent } from '@/components/panel/incidents/ComponentStatusList'
import { zoneName } from '@/components/panel/incidents/format'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { CalendarIcon } from '@/components/ui/icons'
import { RelativeTime } from '@/components/ui/Time'
import { formatDateTime, formatDuration, formatTime, pluralize } from '@/lib/format'
import type { MaintenanceResource } from '@/lib/domain/schemas/maintenances'
import { MaintenanceDialog } from './MaintenanceDialog'
import { MaintenanceStatus } from './MaintenanceStatus'

interface Props {
  projectId: string
  timeZone: string
  active: MaintenanceResource[]
  upcoming: MaintenanceResource[]
  past: MaintenanceResource[]
  pastCursor: string | null
  isFirstPastPage: boolean
  components: PickableComponent[]
  canRespond: boolean
  openNew: boolean
}

const COLUMNS = 'minmax(220px, 2fr) 130px minmax(220px, 1.6fr) minmax(160px, 1.3fr)'

export function MaintenanceManager({ projectId, timeZone, active, upcoming, past, pastCursor, isFirstPastPage, components, canRespond, openNew }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [scheduling, setScheduling] = useState(openNew && canRespond)

  const close = () => {
    setScheduling(false)
    if (searchParams.get('new')) router.replace(pathname, { scroll: false })
  }

  const zone = `${timeZone.replace(/_/g, ' ')} (${zoneName(timeZone)})`
  const schedule = canRespond ? (
    <Button variant="primary" icon={<CalendarIcon size={14} />} onClick={() => setScheduling(true)}>
      Schedule maintenance
    </Button>
  ) : null

  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle={
          active.length > 0
            ? `${pluralize(active.length, 'window')} in progress. Affected components show “Under maintenance”.`
            : upcoming.length > 0
              ? `${pluralize(upcoming.length, 'window')} scheduled. Times in ${zone}.`
              : 'Tell customers about planned work before it happens.'
        }
        actions={schedule}
      />

      {active.length > 0 ? <Section title="In progress" description="Components show “Under maintenance” until the window completes." items={active} projectId={projectId} timeZone={timeZone} /> : null}

      <Section
        title="Upcoming"
        description="Subscribers get a notice when you schedule and a reminder before it starts."
        items={upcoming}
        projectId={projectId}
        timeZone={timeZone}
        empty={
          <EmptyState
            title="No maintenance scheduled"
            description="Schedule planned work so customers know in advance. Affected components switch to maintenance on time and alerts for them can be muted."
            action={schedule}
          />
        }
      />

      <Section
        title="Past"
        description="Completed and cancelled windows, newest first."
        items={past}
        projectId={projectId}
        timeZone={timeZone}
        empty={<p className="mw-section-empty">{isFirstPastPage ? 'No past maintenance yet.' : 'No older maintenance.'}</p>}
        footer={
          pastCursor || !isFirstPastPage ? (
            <div className="inc-pager">
              {!isFirstPastPage ? (
                <ButtonLink href={pathname} size="sm" variant="quiet">
                  Newest
                </ButtonLink>
              ) : (
                <span />
              )}
              {pastCursor ? (
                <ButtonLink href={`${pathname}?cursor=${encodeURIComponent(pastCursor)}`} size="sm">
                  Older maintenance
                </ButtonLink>
              ) : null}
            </div>
          ) : null
        }
      />

      {scheduling ? <MaintenanceDialog projectId={projectId} timeZone={timeZone} components={components} onClose={close} /> : null}
    </>
  )
}

function Section({ title, description, items, projectId, timeZone, empty, footer }: { title: string; description: string; items: MaintenanceResource[]; projectId: string; timeZone: string; empty?: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length === 0 ? (
        empty ?? null
      ) : (
        <div className="tbl-scroll">
          <div className="tbl mw-list" role="table" aria-label={`${title} maintenance`} style={{ ['--cols' as string]: COLUMNS }}>
            <div className="tr th" role="row">
              <span role="columnheader">Maintenance</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Window</span>
              <span role="columnheader">Components</span>
            </div>
            {items.map((item) => (
              <MaintenanceRow key={item.id} projectId={projectId} item={item} timeZone={timeZone} />
            ))}
          </div>
        </div>
      )}
      {footer}
    </Card>
  )
}

function MaintenanceRow({ projectId, item, timeZone }: { projectId: string; item: MaintenanceResource; timeZone: string }) {
  const start = item.actual_start ?? item.scheduled_start
  const end = item.status === 'completed' || item.status === 'cancelled' ? item.actual_end ?? item.scheduled_end : item.scheduled_end
  const sameDay = formatDateTime(start, { timeZone }).split(',')[0] === formatDateTime(end, { timeZone }).split(',')[0]
  const seconds = (Date.parse(end) - Date.parse(start)) / 1000
  return (
    <div className="tr hoverable" role="row">
      <span role="cell" className="c-title mw-title-cell">
        <Link className="rowlink" href={`/p/${projectId}/maintenance/${item.id}`}>
          {item.title}
        </Link>
        <span className="mw-sub">
          {item.status === 'scheduled' ? (
            <span>
              Starts <RelativeTime value={item.scheduled_start} />
              {item.auto_start ? '' : ' · manual start'}
            </span>
          ) : item.status === 'in_progress' ? (
            <span>
              Ends <RelativeTime value={item.scheduled_end} />
              {item.auto_complete ? '' : ' · manual completion'}
            </span>
          ) : (
            <span>
              <RelativeTime value={end} />
            </span>
          )}
        </span>
      </span>
      <span role="cell" className="c-status">
        <MaintenanceStatus status={item.status} />
      </span>
      <span role="cell" className="c-window mw-window">
        <span className="mono num">
          {formatDateTime(start, { timeZone })} → {sameDay ? formatTime(end, { timeZone }) : formatDateTime(end, { timeZone })}
        </span>
        <span className="faint">{item.status === 'cancelled' ? 'Cancelled' : formatDuration(seconds)}</span>
      </span>
      <span role="cell" className="c-comps mw-comps">
        {item.components.length === 0 ? <span className="faint">No components</span> : item.components.map((component) => <span key={component.component_id}>{component.name}</span>)}
      </span>
    </div>
  )
}
