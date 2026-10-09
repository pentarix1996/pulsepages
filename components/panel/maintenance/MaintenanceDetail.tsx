'use client'

import Link from 'next/link'
import { useState } from 'react'
import { MAINTENANCE_STATUS_LABELS } from '@shared/domain.ts'
import type { PickableComponent } from '@/components/panel/incidents/ComponentStatusList'
import { dayKey, zoneName } from '@/components/panel/incidents/format'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { ChevronRightIcon, ExternalLinkIcon, PencilIcon } from '@/components/ui/icons'
import { Chip, StatusPill } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import { formatDate, formatDateTime, formatDuration, formatTime } from '@/lib/format'
import type { MaintenanceResource } from '@/lib/domain/schemas/maintenances'
import { MaintenanceDialog } from './MaintenanceDialog'
import { MaintenanceStatus } from './MaintenanceStatus'

type Action = 'start' | 'complete' | 'cancel'

const ACTIONS: Record<Action, { title: string; verb: string; toast: string; description: string; placeholder: string; tone: 'primary' | 'danger' }> = {
  start: {
    title: 'Start maintenance now?',
    verb: 'Start maintenance',
    toast: 'Maintenance started',
    description: 'Affected components switch to “Under maintenance” right away.',
    placeholder: 'We are starting the planned work now.',
    tone: 'primary',
  },
  complete: {
    title: 'Complete maintenance?',
    verb: 'Complete maintenance',
    toast: 'Maintenance completed',
    description: 'Components return to their automatic status.',
    placeholder: 'The work is done and everything is running normally.',
    tone: 'primary',
  },
  cancel: {
    title: 'Cancel maintenance?',
    verb: 'Cancel maintenance',
    toast: 'Maintenance cancelled',
    description: 'The window stays in the history as cancelled. Components return to their automatic status if it was in progress.',
    placeholder: 'We postponed this work. We will announce a new date.',
    tone: 'danger',
  },
}

interface Props {
  projectId: string
  timeZone: string
  maintenance: MaintenanceResource
  components: PickableComponent[]
  canRespond: boolean
  /** Server time of the render (ms), for the overdue and late-start notices. */
  now: number
}

export function MaintenanceDetail({ projectId, timeZone, maintenance, components, canRespond, now }: Props) {
  const [editing, setEditing] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [message, setMessage] = useState('')
  const act = useAction()
  const update = useAction()
  const base = `/projects/${projectId}/maintenances/${maintenance.id}`
  const closed = maintenance.status === 'completed' || maintenance.status === 'cancelled'
  const zone = `${timeZone.replace(/_/g, ' ')} (${zoneName(timeZone)})`
  const updates = maintenance.updates ?? []

  const runAction = async () => {
    if (!action) return
    const done = await act.run(() => appRequest(`${base}/${action}`, { body: { message: actionMessage.trim() || undefined } }), { success: ACTIONS[action].toast })
    if (done !== undefined) {
      setAction(null)
      setActionMessage('')
    }
  }

  const postUpdate = async () => {
    if (!message.trim()) return
    const done = await update.run(() => appRequest(`${base}/updates`, { body: { message } }), { success: 'Update posted' })
    if (done !== undefined) setMessage('')
  }

  const plannedSeconds = (Date.parse(maintenance.scheduled_end) - Date.parse(maintenance.scheduled_start)) / 1000
  const actualSeconds = maintenance.actual_start && maintenance.actual_end ? (Date.parse(maintenance.actual_end) - Date.parse(maintenance.actual_start)) / 1000 : null
  const overdue = maintenance.status === 'in_progress' && Date.parse(maintenance.scheduled_end) < now
  const lateStart = maintenance.status === 'scheduled' && Date.parse(maintenance.scheduled_start) < now
  const days = updates.map((item) => dayKey(item.created_at, timeZone))

  return (
    <>
      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href={`/p/${projectId}/maintenance`}>Maintenance</Link>
          <ChevronRightIcon size={12} />
          <span className="mono">#{maintenance.id.slice(0, 8)}</span>
        </nav>
        <div className="mw-head">
          <div className="mw-head-main">
            <h1 className="mw-h1">{maintenance.title}</h1>
            <div className="inc-chips">
              <span className="chip">
                <MaintenanceStatus status={maintenance.status} />
              </span>
              <span className="chip mono num">
                {formatDateTime(maintenance.scheduled_start, { timeZone })} → {formatTime(maintenance.scheduled_end, { timeZone })}
              </span>
              <span className="faint" style={{ fontSize: 13 }}>
                Times in {zone}
              </span>
            </div>
          </div>
          <div className="inc-actions">
            <ButtonLink href={maintenance.url} target="_blank" rel="noreferrer" icon={<ExternalLinkIcon size={14} />}>
              View on status page
            </ButtonLink>
            {canRespond && !closed ? (
              <Button icon={<PencilIcon size={14} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {canRespond && maintenance.status === 'scheduled' ? (
              <Button variant="primary" onClick={() => setAction('start')}>
                Start now
              </Button>
            ) : null}
            {canRespond && maintenance.status === 'in_progress' ? (
              <Button variant="primary" onClick={() => setAction('complete')}>
                Complete
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {maintenance.status === 'in_progress' ? (
        <div className="mw-banner" role="status">
          <MaintenanceStatus status="in_progress" />
          <p className="grow">
            {maintenance.components.length > 0 ? `${maintenance.components.map((component) => component.name).join(', ')} show “Under maintenance” on the status page.` : 'No components are marked as under maintenance.'}{' '}
            {maintenance.auto_complete ? <>Completes automatically <RelativeTime value={maintenance.scheduled_end} />.</> : 'Complete it when the work is done.'}
          </p>
        </div>
      ) : null}
      {overdue ? <Banner tone="warning">The window was planned to end {formatDateTime(maintenance.scheduled_end, { timeZone })}. Complete it or extend the end time.</Banner> : null}
      {lateStart ? <Banner tone="warning">{maintenance.auto_start ? 'This window should have started. It starts within a minute.' : 'The planned start has passed. Start it when the work begins, or cancel it.'}</Banner> : null}

      <div className="columns">
        <div className="col-main">
          {maintenance.description ? (
            <Card>
              <CardHeader title="Description" />
              <div className="card-b">
                <p className="mw-desc">{maintenance.description}</p>
              </div>
            </Card>
          ) : null}

          {canRespond && !closed ? (
            <Card aria-label="Post an update">
              <CardHeader title="Post an update" description="Shown with this window on the status page." />
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault()
                  void postUpdate()
                }}
              >
                <Field label="Message">
                  {(props) => <Textarea {...props} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} required placeholder="Half of the database nodes are upgraded. On track to finish on time." />}
                </Field>
                <div className="composer-foot">
                  <span className="composer-hint">Status stays {MAINTENANCE_STATUS_LABELS[maintenance.status].toLowerCase()}. Use the actions above to start, complete or cancel.</span>
                  <Button type="submit" variant="primary" loading={update.pending} disabled={!message.trim()}>
                    Post update
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}

          <Card aria-label="Updates">
            <CardHeader title="Updates" actions={<span className="tl-head-note">Times in {zone}</span>} />
            {updates.length === 0 ? (
              <p className="mw-section-empty">No updates yet.</p>
            ) : (
              <ol className="tl" role="list">
                {updates.map((item, index) => (
                  <li key={item.id} className="tl-ev">
                    <span className="tl-time mono num">
                      {index === 0 || days[index] !== days[index - 1] ? <span className="tl-day">{formatDate(item.created_at, { timeZone }).replace(/, \d{4}$/, '')}</span> : null}
                      <span>{formatTime(item.created_at, { timeZone })}</span>
                    </span>
                    <span className="tl-public" aria-hidden="true" style={{ color: 'var(--maint)' }}>
                      <span className="tl-dot" style={{ display: 'block' }} />
                    </span>
                    <div className="tl-body">
                      <div className="tl-title">
                        {item.status ? <span className={`mw-ev-status is-${item.status}`}>{MAINTENANCE_STATUS_LABELS[item.status]}</span> : null}
                        <strong>{item.actor.label}</strong>
                      </div>
                      <p className="tl-msg">{item.message}</p>
                      <div className="tl-meta">
                        <RelativeTime value={item.created_at} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="col-side" aria-label="Maintenance details">
          <Card className="side-card">
            <h2>Components</h2>
            {maintenance.components.length === 0 ? (
              <p className="help">No components. Customers only see the notice.</p>
            ) : (
              maintenance.components.map((component) => (
                <div key={component.component_id} className="affected-row">
                  <span>{component.name}</span>
                  {maintenance.status === 'in_progress' ? <StatusPill status="maintenance" short /> : <span className="faint mono" style={{ fontSize: 12 }}>{component.slug}</span>}
                </div>
              ))
            )}
          </Card>

          <Card className="side-card">
            <h2>Window</h2>
            <div className="kv-list">
              <div className="kv">
                <span>Planned start</span>
                <span className="mono num">{formatDateTime(maintenance.scheduled_start, { timeZone })}</span>
              </div>
              <div className="kv">
                <span>Planned end</span>
                <span className="mono num">{formatDateTime(maintenance.scheduled_end, { timeZone })}</span>
              </div>
              <div className="kv">
                <span>Planned length</span>
                <span className="mono num">{formatDuration(plannedSeconds)}</span>
              </div>
              <div className="kv">
                <span>Started</span>
                <span className="mono num">{maintenance.actual_start ? formatDateTime(maintenance.actual_start, { timeZone }) : <span className="faint">Not yet</span>}</span>
              </div>
              <div className="kv">
                <span>{maintenance.status === 'cancelled' ? 'Cancelled' : 'Ended'}</span>
                <span className="mono num">{maintenance.actual_end ? formatDateTime(maintenance.actual_end, { timeZone }) : <span className="faint">Not yet</span>}</span>
              </div>
              {actualSeconds !== null ? (
                <div className="kv">
                  <span>Actual length</span>
                  <span className="mono num">{formatDuration(actualSeconds)}</span>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="side-card">
            <h2>Automation and notices</h2>
            <div className="mw-flags">
              <Chip tone={maintenance.auto_start ? 'info' : 'neutral'}>{maintenance.auto_start ? 'Starts automatically' : 'Manual start'}</Chip>
              <Chip tone={maintenance.auto_complete ? 'info' : 'neutral'}>{maintenance.auto_complete ? 'Completes automatically' : 'Manual completion'}</Chip>
              <Chip tone={maintenance.mute_alerts ? 'info' : 'neutral'}>{maintenance.mute_alerts ? 'Alerts muted while in progress' : 'Alerts not muted'}</Chip>
              <Chip tone={maintenance.notify_subscribers ? 'info' : 'neutral'}>
                {maintenance.notify_subscribers ? (maintenance.reminder_minutes > 0 ? `Subscribers notified, reminder ${formatDuration(maintenance.reminder_minutes * 60, { compact: true })} before` : 'Subscribers notified') : 'Subscribers not notified'}
              </Chip>
            </div>
            {canRespond && !closed ? (
              <div className="danger-zone">
                <p>{maintenance.status === 'in_progress' ? 'Stop the window early. It stays in the history as cancelled.' : 'Called off or postponed? Cancel it and schedule a new window.'}</p>
                <div>
                  <Button size="sm" variant="danger-ghost" onClick={() => setAction('cancel')}>
                    Cancel maintenance
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </aside>
      </div>

      {editing ? <MaintenanceDialog projectId={projectId} timeZone={timeZone} components={components} maintenance={maintenance} onClose={() => setEditing(false)} /> : null}
      <Dialog
        open={action !== null}
        onClose={() => setAction(null)}
        title={action ? ACTIONS[action].title : ''}
        description={action ? ACTIONS[action].description : undefined}
        onSubmit={() => void runAction()}
        footer={
          <>
            <Button onClick={() => setAction(null)}>{action === 'cancel' ? 'Keep it' : 'Not now'}</Button>
            <Button type="submit" variant={action ? ACTIONS[action].tone : 'primary'} loading={act.pending}>
              {action ? ACTIONS[action].verb : ''}
            </Button>
          </>
        }
      >
        <Field label="Message on the status page" optional hint="Left empty, Upvane posts a short default message.">
          {(props) => <Textarea {...props} value={actionMessage} onChange={(event) => setActionMessage(event.target.value)} maxLength={5000} placeholder={action ? ACTIONS[action].placeholder : ''} style={{ minHeight: 80 }} />}
        </Field>
      </Dialog>
    </>
  )
}
