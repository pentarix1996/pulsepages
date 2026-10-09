import type { ReactNode } from 'react'
import { Card, CardHeader } from '@/components/ui/Card'
import { RelativeTime } from '@/components/ui/Time'
import { formatDate, formatTime } from '@/lib/format'
import type { IncidentUpdateResource } from '@/lib/domain/schemas/incidents'
import { componentChangesByUpdate, dayKey, describeChange, stageLabel, zoneName } from './format'

type Tone = 'public' | 'internal' | 'system'

function describe(update: IncidentUpdateResource): { tone: Tone; tag: string; tagClass: string; title: string } {
  if (update.kind === 'system') return { tone: 'system', tag: 'System', tagClass: 'tag-system', title: update.actor.label }
  if (update.kind === 'note') return { tone: 'internal', tag: 'Internal', tagClass: 'tag-internal', title: update.actor.label }
  if (update.visibility === 'internal' || update.status === 'draft') return { tone: 'internal', tag: 'Draft', tagClass: 'tag-draft', title: 'Draft opened' }
  return { tone: 'public', tag: 'Public', tagClass: 'tag-public', title: update.status ? stageLabel(update.status) : 'Update' }
}

/** Incident timeline, newest first: public updates, internal notes and logged changes, with component changes. */
export function IncidentTimeline({ updates, componentNames, timeZone, emptyHint }: { updates: IncidentUpdateResource[]; componentNames: Map<string, string>; timeZone: string; emptyHint?: ReactNode }) {
  const changes = componentChangesByUpdate(updates, componentNames)
  const days = updates.map((update) => dayKey(update.created_at, timeZone))
  return (
    <Card aria-label="Timeline">
      <CardHeader title="Timeline" actions={<span className="tl-head-note">Times in {timeZone.replace(/_/g, ' ')} ({zoneName(timeZone)})</span>} />
      {updates.length === 0 ? (
        <p className="help" style={{ padding: 18 }}>
          {emptyHint ?? 'Nothing posted yet.'}
        </p>
      ) : (
        <ol className="tl" role="list" aria-live="polite">
          {updates.map((update, index) => {
            const meta = describe(update)
            const showDay = index === 0 || days[index] !== days[index - 1]
            const updateChanges = changes.get(update.id) ?? []
            return (
              <li key={update.id} className={`tl-ev is-${meta.tone}`}>
                <span className="tl-time mono num">
                  {showDay ? <span className="tl-day">{formatDate(update.created_at, { timeZone }).replace(/, \d{4}$/, '')}</span> : null}
                  <span>{formatTime(update.created_at, { timeZone })}</span>
                </span>
                <span className={`tl-${meta.tone}`} aria-hidden="true">
                  <span className="tl-dot" style={{ display: 'block' }} />
                </span>
                <div className="tl-body">
                  <div className="tl-title">
                    <span className={`tag ${meta.tagClass}`}>{meta.tag}</span>
                    <strong>{meta.title}</strong>
                  </div>
                  <p className="tl-msg">{update.message}</p>
                  {updateChanges.length > 0 ? (
                    <div className="tl-changes">
                      {updateChanges.map((change) => (
                        <span key={change.id} className="tl-change">
                          {change.to ? <span className={`dot s-${change.to}`} aria-hidden="true" /> : null}
                          {describeChange(change)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="tl-meta">
                    {meta.tone === 'public' ? <span>{update.actor.label}</span> : null}
                    {meta.tone === 'public' ? <span>{update.notify_subscribers ? 'Subscribers notified' : 'Subscribers not notified'}</span> : null}
                    <RelativeTime value={update.created_at} />
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
