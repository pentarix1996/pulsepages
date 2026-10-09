'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { PageHeader } from '@/components/panel/PageHeader'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { PlusIcon } from '@/components/ui/icons'
import { Segmented } from '@/components/ui/Segmented'
import { Chip, ImpactChip, StatusPill } from '@/components/ui/Status'
import { Elapsed, RelativeTime } from '@/components/ui/Time'
import { formatDuration, pluralize } from '@/lib/format'
import type { IncidentListFilter, IncidentResource, IncidentTemplateResource } from '@/lib/domain/schemas/incidents'
import type { PickableComponent } from './ComponentStatusList'
import { DeclareIncidentDialog } from './DeclareIncidentDialog'
import { IncidentStage } from './IncidentStage'
import { TemplatesManager } from './TemplatesManager'
import { secondsBetween, SOURCE_LABELS } from './format'

interface Props {
  projectId: string
  tab: 'incidents' | 'templates'
  filter: IncidentListFilter
  incidents: IncidentResource[]
  nextCursor: string | null
  isFirstPage: boolean
  counts: { active: number; draft: number }
  components: PickableComponent[]
  templates: IncidentTemplateResource[]
  canRespond: boolean
  openNew: boolean
}

const COLUMNS = 'minmax(240px, 2.2fr) 128px 128px minmax(170px, 1.5fr) 108px 96px minmax(130px, 1fr)'

const EMPTY: Record<IncidentListFilter, { title: string; description: string }> = {
  active: { title: 'No active incidents', description: 'When customers are affected, declare an incident so they know you are on it.' },
  draft: { title: 'No drafts to review', description: 'Monitors and external alerts open drafts here when automatic drafts are on. Drafts stay private until you publish them.' },
  resolved: { title: 'No resolved incidents yet', description: 'Resolved incidents stay here with their timeline and postmortem.' },
  all: { title: 'No incidents yet', description: 'Declare one when customers are affected, or let monitors open drafts for you to review.' },
}

export function IncidentsManager({ projectId, tab, filter, incidents, nextCursor, isFirstPage, counts, components, templates, canRespond, openNew }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [declaring, setDeclaring] = useState(openNew && canRespond)

  const setFilter = (value: IncidentListFilter) => {
    const next = new URLSearchParams()
    if (value !== 'all') next.set('status', value)
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false })
  }

  const closeDeclare = () => {
    setDeclaring(false)
    if (searchParams.get('new')) {
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false })
    }
  }

  const filterHref = (cursor: string | null) => {
    const next = new URLSearchParams()
    if (filter !== 'all') next.set('status', filter)
    if (cursor) next.set('cursor', cursor)
    return next.size > 0 ? `${pathname}?${next}` : pathname
  }

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle={
          counts.active > 0 ? (
            <>
              <span className="dot dot-pulse-down" style={{ color: 'var(--major)' }} aria-hidden="true" />
              {pluralize(counts.active, 'active incident')}
              {counts.draft > 0 ? <span className="faint">· {pluralize(counts.draft, 'draft')} to review</span> : null}
            </>
          ) : counts.draft > 0 ? (
            <>{pluralize(counts.draft, 'draft')} to review. Drafts stay private until you publish them.</>
          ) : (
            'No active incidents. Public updates you post here appear on your status page.'
          )
        }
        actions={
          canRespond ? (
            <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setDeclaring(true)}>
              Declare incident
            </Button>
          ) : null
        }
      />

      <nav className="tabs" aria-label="Incident views">
        <Link href={pathname} aria-current={tab === 'incidents' ? 'page' : undefined}>
          Incidents
        </Link>
        <Link href={`${pathname}?tab=templates`} aria-current={tab === 'templates' ? 'page' : undefined}>
          Templates
          <span className="count count-neutral">{templates.length}</span>
        </Link>
      </nav>

      {tab === 'templates' ? (
        <TemplatesManager projectId={projectId} templates={templates} components={components} canEdit={canRespond} />
      ) : (
        <Card>
          <CardHeader
            title={filter === 'active' ? 'Active incidents' : filter === 'draft' ? 'Drafts' : filter === 'resolved' ? 'Resolved incidents' : 'All incidents'}
            description="Newest first. Open one to post updates, change component statuses or write the postmortem."
            actions={
              <Segmented<IncidentListFilter>
                label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'active', label: <>Active<span className={['inc-seg-count', counts.active > 0 ? 'hot' : ''].join(' ')}>{counts.active}</span></> },
                  { value: 'draft', label: <>Drafts<span className="inc-seg-count">{counts.draft}</span></> },
                  { value: 'resolved', label: 'Resolved' },
                ]}
              />
            }
          />
          {incidents.length === 0 ? (
            <EmptyState
              title={isFirstPage ? EMPTY[filter].title : 'No more incidents'}
              description={isFirstPage ? EMPTY[filter].description : 'You reached the oldest incident for this filter.'}
              action={
                !isFirstPage ? (
                  <ButtonLink href={filterHref(null)} size="sm">
                    Back to newest
                  </ButtonLink>
                ) : canRespond && (filter === 'all' || filter === 'active') ? (
                  <Button variant="primary" onClick={() => setDeclaring(true)}>
                    Declare incident
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="tbl-scroll">
              <div className="tbl inc-list" role="table" aria-label="Incidents" style={{ ['--cols' as string]: COLUMNS }}>
                <div className="tr th" role="row">
                  <span role="columnheader">Incident</span>
                  <span role="columnheader">Stage</span>
                  <span role="columnheader">Impact</span>
                  <span role="columnheader">Affected components</span>
                  <span role="columnheader">Started</span>
                  <span role="columnheader">Duration</span>
                  <span role="columnheader">Acknowledged</span>
                </div>
                {incidents.map((incident) => (
                  <IncidentRow key={incident.id} projectId={projectId} incident={incident} />
                ))}
              </div>
            </div>
          )}
          {nextCursor || !isFirstPage ? (
            <div className="inc-pager">
              {!isFirstPage ? (
                <ButtonLink href={filterHref(null)} size="sm" variant="quiet">
                  Newest
                </ButtonLink>
              ) : (
                <span />
              )}
              {nextCursor ? (
                <ButtonLink href={filterHref(nextCursor)} size="sm">
                  Older incidents
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </Card>
      )}

      {declaring ? <DeclareIncidentDialog projectId={projectId} components={components} templates={templates} onClose={closeDeclare} /> : null}
    </>
  )
}

function IncidentRow({ projectId, incident }: { projectId: string; incident: IncidentResource }) {
  const active = incident.status !== 'resolved' && incident.status !== 'draft'
  const shown = incident.components.slice(0, 3)
  const resolvedSeconds = secondsBetween(incident.detected_at, incident.resolved_at)
  const duration = incident.status === 'resolved' ? <span className="mono num">{formatDuration(resolvedSeconds)}</span> : <Elapsed since={incident.detected_at} />
  const ack = incident.acknowledged_at ? (
    <span className="stack" style={{ ['--gap' as string]: '1px' }}>
      <span className="truncate">{incident.acknowledged_by?.label ?? 'Acknowledged'}</span>
      <span className="faint" style={{ fontSize: 12 }}>
        after {formatDuration(secondsBetween(incident.detected_at, incident.acknowledged_at), { compact: true })}
      </span>
    </span>
  ) : active || incident.status === 'draft' ? (
    <Chip tone="warning">Not acknowledged</Chip>
  ) : (
    <span className="faint">—</span>
  )

  return (
    <div className="tr hoverable" role="row">
      <span role="cell" className="c-title inc-title-cell">
        <Link className="rowlink" href={`/p/${projectId}/incidents/${incident.id}`}>
          {incident.title}
        </Link>
        <span className="inc-sub">
          <span>{SOURCE_LABELS[incident.source]}</span>
          {incident.postmortem ? <span className={incident.postmortem.status === 'published' ? 's-operational' : undefined}>Postmortem {incident.postmortem.status === 'published' ? 'published' : 'draft'}</span> : null}
        </span>
      </span>
      <span role="cell" className="c-stage">
        <IncidentStage status={incident.status} />
      </span>
      <span role="cell" className="c-impact">
        <ImpactChip impact={incident.impact} />
      </span>
      <span role="cell" className="c-comps inc-comps">
        {incident.components.length === 0 ? <span className="faint">None</span> : null}
        {shown.map((component) => (
          <StatusPill key={component.component_id} status={component.status} short>
            {component.name}
          </StatusPill>
        ))}
        {incident.components.length > shown.length ? <span className="faint">+{incident.components.length - shown.length} more</span> : null}
      </span>
      <span role="cell" className="c-started muted" style={{ fontSize: 13 }}>
        <RelativeTime value={incident.detected_at} />
      </span>
      <span role="cell" className="c-duration" style={{ fontSize: 13 }}>
        {duration}
      </span>
      <span role="cell" className="c-ack" style={{ fontSize: 13 }}>
        {ack}
      </span>
      <span role="cell" className="c-meta">
        <span>
          <span className="inc-cell-label">Started</span>
          <RelativeTime value={incident.detected_at} />
        </span>
        <span>
          <span className="inc-cell-label">{incident.status === 'resolved' ? 'Lasted' : 'Open for'}</span>
          {duration}
        </span>
        <span>
          <span className="inc-cell-label">Acknowledged</span>
          {incident.acknowledged_at ? incident.acknowledged_by?.label ?? 'yes' : 'not yet'}
        </span>
      </span>
    </div>
  )
}
