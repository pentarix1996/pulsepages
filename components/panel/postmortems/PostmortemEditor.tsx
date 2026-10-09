'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { INCIDENT_IMPACT_LABELS } from '@shared/domain.ts'
import { IncidentStage } from '@/components/panel/incidents/IncidentStage'
import { secondsBetween, shortId, zoneName } from '@/components/panel/incidents/format'
import { fromZonedInput, toZonedInput } from '@/components/panel/maintenance/time'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { useConfirm } from '@/components/ui/Dialog'
import { Input, Textarea } from '@/components/ui/Field'
import { ChevronRightIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { ImpactChip } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import { formatDate, formatDateTime, formatDuration } from '@/lib/format'
import type { PostmortemIncidentSummary } from '@/lib/domain/postmortems'
import type { PostmortemResource } from '@/lib/domain/schemas/postmortems'

type SectionKey = 'summary' | 'impact' | 'root_cause' | 'resolution' | 'lessons'

const SECTIONS: Array<{ key: SectionKey; label: string; hint: string; placeholder: string }> = [
  { key: 'summary', label: 'Summary', hint: 'Two or three sentences: what happened, for how long, and who was affected.', placeholder: 'For 40 minutes, about 18% of card payments from EU customers failed.' },
  { key: 'impact', label: 'Impact', hint: 'What customers saw, numbers if you have them, and whether data was affected.', placeholder: 'EU customers saw declined payments; retries succeeded after recovery. No data was lost.' },
  { key: 'root_cause', label: 'Root cause', hint: 'Why it happened, not who caused it.', placeholder: 'A connection pool limit on the primary database was reached after a traffic spike from a batch job.' },
  { key: 'resolution', label: 'Resolution', hint: 'How you stopped the impact and recovered.', placeholder: 'We raised the connection limit, drained stuck connections and moved the batch job to a replica.' },
  { key: 'lessons', label: 'Lessons learned', hint: 'What went well, what did not, and where you got lucky.', placeholder: 'Pool saturation was visible 15 minutes earlier in metrics but did not alert.' },
]

interface ItemDraft {
  key: string
  id?: string
  title: string
  owner: string
  due_date: string
  done: boolean
  url: string
}

interface EntryDraft {
  key: string
  at: string
  message: string
  kind: string | null
  visibility: string | null
  status: string | null
}

interface Draft {
  title: string
  sections: Record<SectionKey, string>
  items: ItemDraft[]
  timeline: EntryDraft[]
}

let keySeed = 0
const nextKey = () => `k${++keySeed}`

function toDraft(postmortem: PostmortemResource): Draft {
  return {
    title: postmortem.title,
    sections: { summary: postmortem.summary, impact: postmortem.impact, root_cause: postmortem.root_cause, resolution: postmortem.resolution, lessons: postmortem.lessons },
    items: postmortem.action_items.map((item) => ({ key: item.id, id: item.id, title: item.title, owner: item.owner ?? '', due_date: item.due_date ?? '', done: item.done, url: item.url ?? '' })),
    timeline: postmortem.timeline.map((entry, index) => ({ key: `t${index}-${entry.at}`, at: entry.at, message: entry.message, kind: entry.kind, visibility: entry.visibility, status: entry.status })),
  }
}

function toBody(draft: Draft) {
  return {
    title: draft.title,
    ...draft.sections,
    action_items: draft.items
      .filter((item) => item.title.trim())
      .map((item) => ({ id: item.id, title: item.title, owner: item.owner || null, due_date: item.due_date || null, done: item.done, url: item.url || null })),
    timeline: draft.timeline
      .filter((entry) => entry.message.trim())
      .map((entry) => ({ at: entry.at, message: entry.message, kind: entry.kind, visibility: entry.visibility, status: entry.status })),
  }
}

function entryLabel(entry: EntryDraft): string {
  if (entry.kind === 'system') return 'System'
  if (entry.kind === 'note' || entry.visibility === 'internal') return 'Internal'
  if (entry.kind === 'update') return entry.status ? entry.status[0]!.toUpperCase() + entry.status.slice(1) : 'Update'
  return 'Added'
}

interface Props {
  projectId: string
  timeZone: string
  postmortem: PostmortemResource
  incident: PostmortemIncidentSummary
  canEdit: boolean
}

export function PostmortemEditor({ projectId, timeZone, postmortem, incident, canEdit }: Props) {
  const confirm = useConfirm()
  const [draft, setDraft] = useState<Draft>(() => toDraft(postmortem))
  const saved = useRef(JSON.stringify(toBody(toDraft(postmortem))))
  const dirty = JSON.stringify(toBody(draft)) !== saved.current
  const save = useAction()
  const publish = useAction()
  const base = `/projects/${projectId}/incidents/${incident.id}/postmortem`
  const published = postmortem.status === 'published'
  const zone = `${timeZone.replace(/_/g, ' ')} (${zoneName(timeZone)})`

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }))
  const setSection = (key: SectionKey, value: string) => setDraft((current) => ({ ...current, sections: { ...current.sections, [key]: value } }))
  const setItem = (key: string, change: Partial<ItemDraft>) => setDraft((current) => ({ ...current, items: current.items.map((item) => (item.key === key ? { ...item, ...change } : item)) }))
  const setEntry = (key: string, change: Partial<EntryDraft>) => setDraft((current) => ({ ...current, timeline: current.timeline.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)) }))

  const persist = () =>
    appRequest<PostmortemResource>(base, { method: 'PUT', body: toBody(draft) }).then((result) => {
      saved.current = JSON.stringify(toBody(toDraft(result)))
      return result
    })

  const onSave = () => void save.run(persist, { success: 'Postmortem saved', successDescription: published ? 'The status page shows the new version.' : undefined })

  const onPublish = async () => {
    const ok = await confirm({
      title: 'Publish this postmortem?',
      description: 'Customers see the title, the five sections and the action item titles on the incident page of your status page. Owners, due dates, links and the timeline stay internal.',
      confirmLabel: dirty ? 'Save and publish' : 'Publish postmortem',
      tone: 'primary',
    })
    if (!ok) return
    await publish.run(
      async () => {
        if (dirty) await persist()
        return appRequest<PostmortemResource>(`${base}/publish`, { method: 'POST' })
      },
      { success: 'Postmortem published' },
    )
  }

  const onUnpublish = async () => {
    const ok = await confirm({ title: 'Unpublish this postmortem?', description: 'It disappears from the status page and becomes a draft again.', confirmLabel: 'Unpublish postmortem' })
    if (ok) await publish.run(() => appRequest(`${base}/unpublish`, { method: 'POST' }), { success: 'Postmortem unpublished' })
  }

  const addItem = () => patch({ items: [...draft.items, { key: nextKey(), title: '', owner: '', due_date: '', done: false, url: '' }] })
  const addEntry = () => {
    const last = draft.timeline[draft.timeline.length - 1]
    patch({ timeline: [...draft.timeline, { key: nextKey(), at: last?.at ?? incident.detected_at, message: '', kind: null, visibility: null, status: null }] })
  }

  const doneCount = draft.items.filter((item) => item.done && item.title.trim()).length
  const itemCount = draft.items.filter((item) => item.title.trim()).length
  const duration = secondsBetween(incident.detected_at, incident.resolved_at)

  return (
    <>
      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href={`/p/${projectId}/incidents`}>Incidents</Link>
          <ChevronRightIcon size={12} />
          <Link href={`/p/${projectId}/incidents/${incident.id}`} className="mono">
            #{shortId(incident.id)}
          </Link>
          <ChevronRightIcon size={12} />
          <span>Postmortem</span>
        </nav>
        <div className="page-head">
          <div className="titles">
            <h1 className="page-title" style={{ overflowWrap: 'anywhere' }}>
              {draft.title || 'Untitled postmortem'}
            </h1>
            <div className="page-sub">
              <span className={['chip', published ? 'chip-success' : 'chip-draft'].join(' ')}>{published ? 'Published' : 'Draft, not public'}</span>
              <span>
                For <Link href={`/p/${projectId}/incidents/${incident.id}`}>{incident.title}</Link>
              </span>
              <span className="faint">
                · Saved <RelativeTime value={postmortem.updated_at} />
              </span>
            </div>
          </div>
          {canEdit ? (
            <div className="page-actions">
              <span className={['pm-save-state', dirty ? 'dirty' : ''].join(' ')} style={{ alignSelf: 'center' }} aria-live="polite">
                {dirty ? 'Unsaved changes' : 'All changes saved'}
              </span>
              <Button onClick={onSave} loading={save.pending} disabled={!dirty || publish.pending}>
                Save
              </Button>
              {published ? (
                <Button onClick={() => void onUnpublish()} loading={publish.pending}>
                  Unpublish
                </Button>
              ) : (
                <Button variant="primary" onClick={() => void onPublish()} loading={publish.pending} disabled={incident.status !== 'resolved'}>
                  Publish
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {canEdit && !published && incident.status !== 'resolved' ? <Banner tone="info">Resolve the incident before publishing its postmortem. You can keep writing in the meantime.</Banner> : null}
      {published && dirty ? <Banner tone="warning">This postmortem is public. Saving updates the status page right away.</Banner> : null}

      <div className="columns">
        <div className="col-main">
          <Card>
            <CardHeader title="Write-up" description={canEdit ? 'Blameless and specific. Customers read these sections once you publish.' : undefined} />
            <div className="card-b stack" style={{ ['--gap' as string]: '18px' }}>
              {canEdit ? (
                <div className="pm-section">
                  <label className="field-label" htmlFor="pm-title">
                    Title
                  </label>
                  <Input id="pm-title" value={draft.title} onChange={(event) => patch({ title: event.target.value })} maxLength={200} required />
                </div>
              ) : null}
              {SECTIONS.map((section) => (
                <div key={section.key} className="pm-section">
                  <label className="field-label" htmlFor={`pm-${section.key}`}>
                    {section.label}
                  </label>
                  {canEdit ? (
                    <>
                      <span className="field-hint">{section.hint}</span>
                      <Textarea id={`pm-${section.key}`} value={draft.sections[section.key]} onChange={(event) => setSection(section.key, event.target.value)} maxLength={20000} placeholder={section.placeholder} />
                    </>
                  ) : (
                    <p id={`pm-${section.key}`} className={['pm-readonly', draft.sections[section.key] ? '' : 'empty'].join(' ')}>
                      {draft.sections[section.key] || 'Not written yet.'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Action items"
              description={itemCount > 0 ? `${doneCount} of ${itemCount} done. Customers see titles and progress, not owners or links.` : 'Follow-ups that stop this from happening again.'}
              actions={
                canEdit ? (
                  <Button size="sm" variant="ghost" icon={<PlusIcon size={14} />} onClick={addItem}>
                    Add action item
                  </Button>
                ) : null
              }
            />
            {draft.items.length === 0 ? (
              <p className="mw-section-empty">No action items yet.</p>
            ) : (
              <div className="pm-items" role="list">
                <div className="pm-item th" aria-hidden="true">
                  <span />
                  <span>Action</span>
                  <span>Owner</span>
                  <span>Due</span>
                  <span>Ticket or PR</span>
                  <span />
                </div>
                {draft.items.map((item, index) => (
                  <div key={item.key} className={['pm-item', item.done ? 'done' : ''].join(' ')} role="listitem">
                    <span className="pm-c-check">
                      <input type="checkbox" className="pm-check" checked={item.done} disabled={!canEdit} onChange={(event) => setItem(item.key, { done: event.target.checked })} aria-label={`Mark action item ${index + 1} as done`} />
                    </span>
                    {canEdit ? (
                      <>
                        <Input className="pm-c-title pm-item-title" aria-label={`Action item ${index + 1}`} value={item.title} onChange={(event) => setItem(item.key, { title: event.target.value })} placeholder="Alert on connection pool usage above 80%" maxLength={300} />
                        <Input className="pm-c-owner" aria-label="Owner" value={item.owner} onChange={(event) => setItem(item.key, { owner: event.target.value })} placeholder="Owner" maxLength={120} />
                        <Input className="pm-c-due mono" type="date" aria-label="Due date" value={item.due_date} onChange={(event) => setItem(item.key, { due_date: event.target.value })} />
                        <Input className="pm-c-link mono" type="url" aria-label="Ticket or pull request link" value={item.url} onChange={(event) => setItem(item.key, { url: event.target.value })} placeholder="https://" maxLength={2048} />
                        <Button className="pm-c-remove" size="sm" variant="quiet" iconOnly aria-label={`Remove action item ${index + 1}`} icon={<TrashIcon size={14} />} onClick={() => patch({ items: draft.items.filter((other) => other.key !== item.key) })} />
                      </>
                    ) : (
                      <>
                        <span className="pm-c-title pm-item-title">{item.title}</span>
                        <span className="pm-c-owner muted">{item.owner || '—'}</span>
                        <span className="pm-c-due mono num muted">{item.due_date ? formatDate(item.due_date) : '—'}</span>
                        <span className="pm-c-link truncate">
                          {item.url ? (
                            <a className="link" href={item.url} target="_blank" rel="noreferrer">
                              Open link
                            </a>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </span>
                        <span className="pm-c-remove" />
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Timeline"
              description={`Internal reconstruction of what happened. Times in ${zone}.`}
              actions={
                canEdit ? (
                  <Button size="sm" variant="ghost" icon={<PlusIcon size={14} />} onClick={addEntry}>
                    Add entry
                  </Button>
                ) : null
              }
            />
            {draft.timeline.length === 0 ? (
              <p className="mw-section-empty">No timeline entries.</p>
            ) : (
              <div className="pm-tl" role="list">
                {draft.timeline.map((entry, index) => (
                  <div key={entry.key} className="pm-tl-row" role="listitem">
                    <div className="pm-c-at stack" style={{ ['--gap' as string]: '4px' }}>
                      {canEdit ? (
                        <Input
                          type="datetime-local"
                          className="mono"
                          aria-label={`Time of entry ${index + 1}`}
                          value={toZonedInput(entry.at, timeZone)}
                          onChange={(event) => {
                            const iso = fromZonedInput(event.target.value, timeZone)
                            if (iso) setEntry(entry.key, { at: iso })
                          }}
                        />
                      ) : (
                        <span className="mono num muted" style={{ fontSize: 13 }}>
                          {formatDateTime(entry.at, { timeZone })}
                        </span>
                      )}
                      <span className="faint" style={{ fontSize: 12 }}>
                        {entryLabel(entry)}
                      </span>
                    </div>
                    {canEdit ? (
                      <Textarea className="pm-c-msg" aria-label={`Entry ${index + 1}`} value={entry.message} onChange={(event) => setEntry(entry.key, { message: event.target.value })} maxLength={2000} rows={2} placeholder="What happened at this time" />
                    ) : (
                      <p className="pm-c-msg pm-readonly">{entry.message}</p>
                    )}
                    {canEdit ? (
                      <Button className="pm-c-remove" size="sm" variant="quiet" iconOnly aria-label={`Remove entry ${index + 1}`} icon={<TrashIcon size={14} />} onClick={() => patch({ timeline: draft.timeline.filter((other) => other.key !== entry.key) })} />
                    ) : (
                      <span className="pm-c-remove" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="col-side" aria-label="Incident">
          <Card className="side-card">
            <h2>Incident</h2>
            <Link href={`/p/${projectId}/incidents/${incident.id}`} className="link" style={{ overflowWrap: 'anywhere' }}>
              {incident.title}
            </Link>
            <div className="inc-chips">
              <ImpactChip impact={incident.impact} />
              <IncidentStage status={incident.status} />
            </div>
            <div className="kv-list">
              <div className="kv">
                <span>Detected</span>
                <span className="mono num">{formatDateTime(incident.detected_at, { timeZone })}</span>
              </div>
              <div className="kv">
                <span>Acknowledged</span>
                <span className="mono num">{incident.acknowledged_at ? formatDateTime(incident.acknowledged_at, { timeZone }) : '—'}</span>
              </div>
              <div className="kv">
                <span>Resolved</span>
                <span className="mono num">{incident.resolved_at ? formatDateTime(incident.resolved_at, { timeZone }) : 'Not yet'}</span>
              </div>
              <div className="kv">
                <span>Duration</span>
                <span className="mono num">{duration === null ? '—' : formatDuration(duration)}</span>
              </div>
              <div className="kv">
                <span>Impact</span>
                <span>{INCIDENT_IMPACT_LABELS[incident.impact]}</span>
              </div>
            </div>
          </Card>
          <Card className="side-card">
            <h2>On the status page</h2>
            <p className="help">
              {published
                ? `Published ${postmortem.published_at ? formatDateTime(postmortem.published_at, { timeZone }) : ''}. Customers read it on the incident page.`
                : 'Not public. Publish it to show it on the incident page of your status page.'}
            </p>
            <p className="help">Public: title, summary, impact, root cause, resolution, lessons and action item titles with their progress. Internal: owners, due dates, links and the timeline.</p>
          </Card>
        </aside>
      </div>
    </>
  )
}
