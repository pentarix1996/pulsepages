'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { INCIDENT_IMPACT_LABELS, INCIDENT_IMPACTS, INCIDENT_STATUS_HINTS, type ComponentStatus, type IncidentImpact } from '@shared/domain.ts'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { useConfirm } from '@/components/ui/Dialog'
import { Input, Switch } from '@/components/ui/Field'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, PencilIcon } from '@/components/ui/icons'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Segmented } from '@/components/ui/Segmented'
import { ImpactChip, StatusPill } from '@/components/ui/Status'
import { Elapsed, RelativeTime } from '@/components/ui/Time'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import { formatDateTime, formatDuration } from '@/lib/format'
import type { ActorResource, IncidentResource } from '@/lib/domain/schemas/incidents'
import type { PostmortemResource } from '@/lib/domain/schemas/postmortems'
import { ComponentStatusList, type PickableComponent } from './ComponentStatusList'
import { IncidentStage } from './IncidentStage'
import { IncidentTimeline } from './IncidentTimeline'
import { PUBLIC_STAGES, RESOLVE_MESSAGE, secondsBetween, shortId, SOURCE_LABELS, STAGE_ORDER, stageLabel, type PublicStage } from './format'

interface Props {
  projectId: string
  timeZone: string
  incident: IncidentResource
  components: PickableComponent[]
  openedBy: ActorResource | null
  sourceMonitor: { id: string; name: string } | null
  canRespond: boolean
  canDelete: boolean
}

type Edits = Record<string, ComponentStatus | null>

function applyEdits(baseline: Record<string, ComponentStatus>, edits: Edits): Record<string, ComponentStatus> {
  const result = { ...baseline }
  for (const [id, status] of Object.entries(edits)) {
    if (status === null) delete result[id]
    else result[id] = status
  }
  return result
}

function diffEdits(next: Record<string, ComponentStatus>, baseline: Record<string, ComponentStatus>): Edits {
  const edits: Edits = {}
  for (const [id, status] of Object.entries(next)) if (baseline[id] !== status) edits[id] = status
  for (const id of Object.keys(baseline)) if (!(id in next)) edits[id] = null
  return edits
}

export function IncidentCommand({ projectId, timeZone, incident, components, openedBy, sourceMonitor, canRespond, canDelete }: Props) {
  const router = useRouter()
  const confirm = useConfirm()
  const base = `/projects/${projectId}/incidents/${incident.id}`
  const isDraft = incident.status === 'draft'
  const isResolved = incident.status === 'resolved'
  const isActive = !isDraft && !isResolved

  // Composer state (lifted so the header's "Resolve incident" can prefill it).
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public')
  const [stageChoice, setStageChoice] = useState<PublicStage | null>(null)
  const [edits, setEdits] = useState<Edits>({})
  const [message, setMessage] = useState('')
  const [notify, setNotify] = useState(true)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(incident.title)

  const composer = useAction()
  const details = useAction()
  const ack = useAction()
  const removal = useAction()
  const postmortem = useAction()

  const currentStage: PublicStage = isDraft ? 'investigating' : (incident.status as PublicStage)
  const stage = stageChoice ?? currentStage
  const baseline = Object.fromEntries(incident.components.map((component) => [component.component_id, component.status])) as Record<string, ComponentStatus>
  const working = applyEdits(baseline, edits)
  const removed = Object.entries(edits).filter(([, status]) => status === null).map(([id]) => incident.components.find((component) => component.component_id === id)?.name ?? 'A component')
  const isPublic = visibility === 'public'
  const resolving = isPublic && stage === 'resolved' && !isResolved
  const verb = !isPublic ? 'Add note' : isDraft ? 'Publish incident' : resolving ? 'Resolve incident' : 'Post update'
  const needsMessage = !(isPublic && isDraft)

  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      messageRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      messageRef.current?.focus({ preventScroll: true })
    })
  }

  const prepareResolve = () => {
    setVisibility('public')
    setStageChoice('resolved')
    setEdits(Object.fromEntries(incident.components.filter((component) => component.status !== 'operational').map((component) => [component.component_id, 'operational' as const])))
    if (!message.trim()) setMessage(RESOLVE_MESSAGE)
    focusComposer()
  }

  const preparePublish = () => {
    setVisibility('public')
    focusComposer()
  }

  const post = async () => {
    const text = message.trim()
    if (needsMessage && !text) {
      messageRef.current?.focus()
      return
    }
    const changes = Object.keys(edits).length > 0 ? edits : undefined
    const done = await composer.run(
      () => {
        if (!isPublic) return appRequest(`${base}/updates`, { body: { message: text, visibility: 'internal' } })
        if (isDraft) return appRequest(`${base}/publish`, { body: { message: text || undefined, status: stage, components: changes, notify_subscribers: notify } })
        return appRequest(`${base}/updates`, { body: { message: text, status: stage, visibility: 'public', components: changes, notify_subscribers: notify } })
      },
      { success: !isPublic ? 'Note added' : isDraft ? 'Incident published' : resolving ? 'Incident resolved' : 'Update posted' },
    )
    if (done !== undefined) {
      setMessage('')
      setEdits({})
      setStageChoice(null)
    }
  }

  const saveTitle = async () => {
    const title = titleDraft.trim()
    if (!title || title === incident.title) {
      setEditingTitle(false)
      return
    }
    const done = await details.run(() => appRequest(base, { method: 'PATCH', body: { title } }), { success: 'Title saved' })
    if (done !== undefined) setEditingTitle(false)
  }

  const changeImpact = (impact: IncidentImpact) => {
    if (impact === incident.impact) return
    void details.run(() => appRequest(base, { method: 'PATCH', body: { impact } }), { success: `Impact changed to ${INCIDENT_IMPACT_LABELS[impact].toLowerCase()}` })
  }

  const acknowledge = () => void ack.run(() => appRequest(`${base}/acknowledge`, { method: 'POST' }), { success: 'Acknowledged', successDescription: 'Your team can see you are on it.' })

  const createPostmortem = async () => {
    const created = await postmortem.run(() => appRequest<PostmortemResource>(`${base}/postmortem`, { method: 'POST' }), { success: 'Postmortem draft created', refresh: false })
    if (created) router.push(`/p/${projectId}/postmortems/${created.id}`)
  }

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this incident?',
      description: 'It disappears from the status page and its components go back to their automatic status. The audit log keeps a record.',
      confirmLabel: 'Delete incident',
    })
    if (!ok) return
    const done = await removal.run(() => appRequest(base, { method: 'DELETE' }).then(() => true), { success: 'Incident deleted', refresh: false })
    if (done) router.push(`/p/${projectId}/incidents`)
  }

  const componentNames = new Map<string, string>([...components.map((component) => [component.id, component.name] as const), ...incident.components.map((component) => [component.component_id, component.name] as const)])
  const resolvedAfter = secondsBetween(incident.detected_at, incident.resolved_at)

  return (
    <>
      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href={`/p/${projectId}/incidents`}>Incidents</Link>
          <ChevronRightIcon size={12} />
          <span className="mono">#{shortId(incident.id)}</span>
        </nav>
        <div className="inc-head">
          <div className="inc-head-main">
            {editingTitle ? (
              <form
                className="inc-title-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveTitle()
                }}
              >
                <label className="sr-only" htmlFor="incident-title">
                  Incident title
                </label>
                <Input
                  id="incident-title"
                  className="inc-title-input"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setTitleDraft(incident.title)
                      setEditingTitle(false)
                    }
                  }}
                  maxLength={200}
                  required
                  autoFocus
                />
                <Button type="submit" variant="primary" loading={details.pending}>
                  Save title
                </Button>
                <Button
                  onClick={() => {
                    setTitleDraft(incident.title)
                    setEditingTitle(false)
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="inc-h1-row">
                <h1 className="inc-h1">{incident.title}</h1>
                {canRespond ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    iconOnly
                    aria-label="Edit title"
                    icon={<PencilIcon size={14} />}
                    onClick={() => {
                      setTitleDraft(incident.title)
                      setEditingTitle(true)
                    }}
                  />
                ) : null}
              </div>
            )}
            <div className="inc-chips">
              {canRespond ? (
                <Menu
                  label="Impact"
                  align="left"
                  trigger={(props) => (
                    <button type="button" className="impact-trigger" aria-label={`Impact: ${INCIDENT_IMPACT_LABELS[incident.impact]}. Change impact`} {...props}>
                      <ImpactChip impact={incident.impact} />
                      <ChevronDownIcon size={12} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <div className="menu-label">Impact</div>
                      {INCIDENT_IMPACTS.map((impact) => (
                        <MenuItem
                          key={impact}
                          icon={impact === incident.impact ? <CheckIcon size={14} /> : <span style={{ width: 14 }} />}
                          onSelect={() => {
                            close()
                            changeImpact(impact)
                          }}
                        >
                          {INCIDENT_IMPACT_LABELS[impact]}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Menu>
              ) : (
                <ImpactChip impact={incident.impact} />
              )}
              <span className={['chip', isDraft ? 'chip-draft' : 'chip-live'].join(' ')}>
                <IncidentStage status={incident.status} />
              </span>
              <span className="chip mono num" title={isResolved ? 'Time from detection to resolution' : 'Time since detection'}>
                {isResolved ? `Resolved after ${formatDuration(resolvedAfter)}` : <Elapsed since={incident.detected_at} />}
              </span>
              <span className="opened">
                Opened by {openedBy?.label ?? 'Upvane'}
                {sourceMonitor ? (
                  <>
                    {' '}
                    from the <Link href={`/p/${projectId}/monitors/${sourceMonitor.id}`}>{sourceMonitor.name}</Link> monitor
                  </>
                ) : incident.source === 'signal' ? (
                  ' from an external alert'
                ) : incident.source === 'api' ? (
                  ' through the API'
                ) : incident.source === 'template' ? (
                  ' from a template'
                ) : null}
              </span>
            </div>
          </div>
          <div className="inc-actions">
            {incident.url ? (
              <ButtonLink href={incident.url} target="_blank" rel="noreferrer" icon={<ExternalLinkIcon size={14} />}>
                View on status page
              </ButtonLink>
            ) : null}
            {canRespond && isActive ? <Button onClick={prepareResolve}>Resolve incident</Button> : null}
            {canRespond && isDraft ? (
              <Button variant="primary" onClick={preparePublish}>
                Publish
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {isDraft ? (
        <Banner tone="warning">
          <strong>Draft, not public.</strong> Only your team can see it. Components keep their status and subscribers hear nothing until you publish it.
        </Banner>
      ) : null}
      {canRespond && !incident.acknowledged_at && !isResolved ? (
        <Banner
          tone="danger"
          action={
            <Button size="sm" variant="primary" loading={ack.pending} onClick={acknowledge}>
              Acknowledge
            </Button>
          }
        >
          Nobody has acknowledged this incident yet. Acknowledge it so your team knows you are on it.
        </Banner>
      ) : null}

      <div className="columns">
        <div className="col-main">
          {canRespond ? (
            <Card aria-label="Post an update">
              <CardHeader
                title={isDraft ? 'Publish or add a note' : 'Post an update'}
                actions={
                  <Segmented<'public' | 'internal'>
                    label="Visibility"
                    value={visibility}
                    onChange={setVisibility}
                    options={[
                      { value: 'public', label: isDraft ? 'Publish' : 'Public update' },
                      { value: 'internal', label: 'Internal note' },
                    ]}
                  />
                }
              />
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault()
                  void post()
                }}
              >
                {isPublic ? (
                  <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                    <div className="stages" role="group" aria-label="Stage after this update">
                      {PUBLIC_STAGES.map((value) => {
                        const past = !isDraft && STAGE_ORDER[value] < STAGE_ORDER[incident.status] && value !== stage
                        return (
                          <button key={value} type="button" className={['stage', past ? 'past' : ''].filter(Boolean).join(' ')} aria-pressed={value === stage} onClick={() => setStageChoice(value === currentStage ? null : value)}>
                            <span className="stage-bar" />
                            {stageLabel(value)}
                            {value === currentStage && !isDraft ? <span className="stage-hint">Current</span> : null}
                          </button>
                        )
                      })}
                    </div>
                    <span className="composer-hint">{INCIDENT_STATUS_HINTS[stage]}</span>
                  </div>
                ) : null}

                <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                  <label htmlFor="incident-message" className="composer-label">
                    {isPublic ? 'Message' : 'Note'}
                  </label>
                  <textarea
                    id="incident-message"
                    className="textarea"
                    ref={messageRef}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={5000}
                    placeholder={isPublic ? 'What changed, what customers should do, and when you will update next.' : 'Findings, commands you ran, links to dashboards. Only your team sees notes.'}
                  />
                </div>

                {isPublic ? (
                  <div className="stack" style={{ ['--gap' as string]: '10px' }}>
                    <span className="composer-label">Component status after this update</span>
                    <ComponentStatusList
                      components={components}
                      value={working}
                      onChange={(next) => setEdits(diffEdits(next, baseline))}
                      baseline={baseline}
                      defaultStatus="degraded"
                      emptyText="No components are affected. Add the ones customers notice."
                    />
                    {removed.length > 0 ? (
                      <p className="removed-note">
                        {removed.join(', ')} {removed.length === 1 ? 'leaves' : 'leave'} the incident and {removed.length === 1 ? 'returns' : 'return'} to automatic status.{' '}
                        <button type="button" onClick={() => setEdits(Object.fromEntries(Object.entries(edits).filter(([, status]) => status !== null)))}>
                          Undo
                        </button>
                      </p>
                    ) : null}
                    <div className="composer-toggles">
                      <Switch label="Notify status page subscribers" checked={notify} onChange={setNotify} />
                    </div>
                  </div>
                ) : null}

                <div className="composer-foot">
                  <span className="composer-hint">
                    {!isPublic
                      ? 'Only your team sees internal notes. Nothing changes on the status page.'
                      : isDraft
                        ? `Publishes the incident on the status page${notify ? ' and notifies subscribers' : ''}. Component statuses apply right away.`
                        : `Goes to the status page${notify ? ' and notifies subscribers' : ', without notifying subscribers'}.${resolving ? ' Components return to their automatic status.' : ''}`}
                  </span>
                  <Button type="submit" variant="primary" loading={composer.pending}>
                    {verb}
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}

          <IncidentTimeline updates={incident.updates ?? []} componentNames={componentNames} timeZone={timeZone} />
        </div>

        <aside className="col-side" aria-label="Incident details">
          <Card className="side-card">
            <h2>Affected components</h2>
            {incident.components.length === 0 ? (
              <p className="help">No components. Customers only see the incident.</p>
            ) : (
              incident.components.map((component) => (
                <div key={component.component_id} className="affected-row">
                  <span>{component.name}</span>
                  <StatusPill status={component.status} short />
                </div>
              ))
            )}
            {isDraft && incident.components.length > 0 ? <p className="help">Applied when you publish.</p> : null}
          </Card>

          <ResponseCard incident={incident} timeZone={timeZone} canRespond={canRespond} acknowledging={ack.pending} onAcknowledge={acknowledge} />

          <Card className="side-card">
            <div className="spread">
              <h2>Postmortem</h2>
              {incident.postmortem ? <span className={['chip', incident.postmortem.status === 'published' ? 'chip-success' : 'chip-draft'].join(' ')}>{incident.postmortem.status === 'published' ? 'Published' : 'Draft'}</span> : null}
            </div>
            {incident.postmortem ? (
              <>
                <p className="help">
                  {incident.postmortem.status === 'published' ? 'Customers can read it on the incident page of your status page.' : 'Only your team can see it until you publish it.'}
                </p>
                <div className="side-actions">
                  <ButtonLink href={`/p/${projectId}/postmortems/${incident.postmortem.id}`} size="sm" variant={incident.postmortem.status === 'published' ? 'ghost' : 'primary'}>
                    {canRespond && incident.postmortem.status === 'draft' ? 'Continue writing' : 'Open postmortem'}
                  </ButtonLink>
                </div>
              </>
            ) : (
              <>
                <p className="help">
                  {isResolved
                    ? 'Write down what happened, why, and what you will change. The draft starts with this timeline.'
                    : 'Major and critical incidents get a draft when you resolve them. You can also start one now; it starts with this timeline.'}
                </p>
                {canRespond ? (
                  <div className="side-actions">
                    <Button size="sm" variant={isResolved ? 'primary' : 'ghost'} loading={postmortem.pending} onClick={() => void createPostmortem()}>
                      Create postmortem
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>

          <Card className="side-card">
            <h2>Details</h2>
            <div className="kv-list">
              <div className="kv">
                <span>Source</span>
                <span>{SOURCE_LABELS[incident.source]}</span>
              </div>
              <div className="kv">
                <span>Opened by</span>
                <span>{openedBy?.label ?? 'Upvane'}</span>
              </div>
              <div className="kv">
                <span>Incident id</span>
                <span className="mono" style={{ fontSize: 12.5 }}>
                  {incident.id}
                </span>
              </div>
              <div className="kv">
                <span>Public page</span>
                <span>
                  {incident.url ? (
                    <a className="link" href={incident.url} target="_blank" rel="noreferrer">
                      Open permalink
                    </a>
                  ) : (
                    <span className="faint">Not public yet</span>
                  )}
                </span>
              </div>
            </div>
            {canDelete ? (
              <div className="danger-zone">
                <p>Deleting removes the incident from the status page. Use it for incidents declared by mistake.</p>
                <div>
                  <Button size="sm" variant="danger-ghost" loading={removal.pending} onClick={() => void remove()}>
                    Delete incident
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  )
}

function ResponseCard({ incident, timeZone, canRespond, acknowledging, onAcknowledge }: { incident: IncidentResource; timeZone: string; canRespond: boolean; acknowledging: boolean; onAcknowledge: () => void }) {
  const since = (value: string | null) => {
    const seconds = secondsBetween(incident.detected_at, value)
    return seconds === null ? null : <span className="sub">({formatDuration(seconds, { compact: true })})</span>
  }
  const ttaSeconds = secondsBetween(incident.detected_at, incident.acknowledged_at)
  const ttrSeconds = secondsBetween(incident.detected_at, incident.resolved_at)
  return (
    <Card className="side-card">
      <h2>Response</h2>
      <div className="kv-list">
        <div className="kv">
          <span>Detected</span>
          <span className="mono num">{formatDateTime(incident.detected_at, { timeZone })}</span>
        </div>
        <div className="kv">
          <span>Acknowledged</span>
          <span className="mono num">
            {incident.acknowledged_at ? (
              <>
                {formatDateTime(incident.acknowledged_at, { timeZone })}
                {since(incident.acknowledged_at)}
              </>
            ) : (
              <span className="faint">Not yet</span>
            )}
          </span>
        </div>
        {incident.acknowledged_by ? (
          <div className="kv">
            <span>Acknowledged by</span>
            <span>{incident.acknowledged_by.label}</span>
          </div>
        ) : null}
        <div className="kv">
          <span>Published</span>
          <span className="mono num">
            {incident.published_at ? (
              <>
                {formatDateTime(incident.published_at, { timeZone })}
                {since(incident.published_at)}
              </>
            ) : (
              <span className="faint">Draft</span>
            )}
          </span>
        </div>
        <div className="kv">
          <span>Resolved</span>
          <span className="mono num">
            {incident.resolved_at ? (
              <>
                {formatDateTime(incident.resolved_at, { timeZone })}
                {since(incident.resolved_at)}
              </>
            ) : (
              <span className="faint">Not yet</span>
            )}
          </span>
        </div>
        <div className="kv">
          <span>Time to acknowledge</span>
          <span className="mono num">{ttaSeconds === null ? <span className="faint">—</span> : formatDuration(ttaSeconds)}</span>
        </div>
        <div className="kv">
          <span>Time to resolve</span>
          <span className="mono num">{ttrSeconds === null ? incident.status === 'draft' ? <span className="faint">—</span> : <Elapsed since={incident.detected_at} /> : formatDuration(ttrSeconds)}</span>
        </div>
      </div>
      {canRespond && !incident.acknowledged_at && incident.status !== 'resolved' ? (
        <div className="side-actions">
          <Button size="sm" variant="primary" loading={acknowledging} onClick={onAcknowledge}>
            Acknowledge
          </Button>
          <span className="help" style={{ alignSelf: 'center' }}>
            Detected <RelativeTime value={incident.detected_at} />
          </span>
        </div>
      ) : null}
    </Card>
  )
}
