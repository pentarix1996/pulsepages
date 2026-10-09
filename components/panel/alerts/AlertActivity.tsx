'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ALERT_EVENT_LABELS, ALERT_EVENT_TYPES, type AlertEventType } from '@shared/domain.ts'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Chip, type ChipTone } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import type { AlertEventResource } from '@/lib/domain/schemas/alerts'
import { suppressionText } from '@/lib/domain/schemas/alerts'
import { formatDateTime } from '@/lib/format'

type StatusFilter = 'all' | 'processed' | 'suppressed' | 'failed' | 'pending'

interface Props {
  events: AlertEventResource[]
  nextCursor: string | null
  isFirstPage: boolean
  type: string | null
  status: StatusFilter
  timeZone: string
}

const STATUS_TEXT: Record<AlertEventResource['status'], string> = { processed: 'Sent', pending: 'Sending', suppressed: 'Held back', failed: 'Failed' }
const DELIVERY_TONE: Record<string, ChipTone> = { sent: 'success', failed: 'danger', retryable: 'warning', pending: 'info', processing: 'info', suppressed: 'neutral' }
const DELIVERY_TEXT: Record<string, string> = { sent: 'delivered', failed: 'failed', retryable: 'retrying', pending: 'queued', processing: 'sending', suppressed: 'held back' }

export function AlertActivity({ events, nextCursor, isFirstPage, type, status, timeZone }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    return next.size > 0 ? `${pathname}?${next}` : pathname
  }
  const filter = (changes: Record<string, string | null>) => router.replace(href({ ...changes, cursor: null }), { scroll: false })

  return (
    <Card>
      <CardHeader
        title="Activity"
        description="Every team alert event, what it matched and how each delivery went."
        actions={
          <Select
            aria-label="Filter by event"
            value={type ?? ''}
            onChange={(event) => filter({ type: event.target.value || null })}
            options={[{ value: '', label: 'All events' }, ...ALERT_EVENT_TYPES.map((value) => ({ value, label: ALERT_EVENT_LABELS[value] }))]}
          />
        }
      />
      <div className="al-filters">
        <Segmented<StatusFilter>
          label="Filter by result"
          value={status}
          onChange={(value) => filter({ status: value === 'all' ? null : value })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'processed', label: 'Sent' },
            { value: 'suppressed', label: 'Held back' },
            { value: 'failed', label: 'Failed' },
            { value: 'pending', label: 'Sending' },
          ]}
        />
      </div>
      {events.length === 0 ? (
        <EmptyState title={type || status !== 'all' ? 'No events match' : 'No alert events yet'} description={type || status !== 'all' ? 'Try another event or result.' : 'Events appear here when a component changes, a monitor fails or an incident moves. Send a test alert from a channel to see one now.'} />
      ) : (
        <div>
          {events.map((event) => {
            const why = event.status === 'suppressed' ? suppressionText(event.suppression_reason) : null
            const failed = event.deliveries.filter((delivery) => delivery.status === 'failed')
            return (
              <div key={event.id} className="al-event">
                <div className="al-event-title">
                  <strong>{event.title}</strong>
                  <span className="al-event-meta">
                    <span>{ALERT_EVENT_LABELS[event.type as AlertEventType] ?? event.type}</span>
                    <span title={formatDateTime(event.created_at, { timeZone, withZone: true })}>
                      <RelativeTime value={event.created_at} />
                    </span>
                    <span>{event.deliveries.length === 0 ? 'No deliveries' : `${event.deliveries.length} ${event.deliveries.length === 1 ? 'delivery' : 'deliveries'}`}</span>
                  </span>
                </div>
                <span className={`al-ev-status is-${event.status}`}>{STATUS_TEXT[event.status]}</span>
                {why ? <p className="al-event-why">{why}</p> : null}
                {event.deliveries.length > 0 ? (
                  <div className="al-deliveries">
                    {event.deliveries.map((delivery) => (
                      <Chip key={delivery.id} tone={DELIVERY_TONE[delivery.status] ?? 'neutral'} title={delivery.error_message ?? (delivery.attempts > 1 ? `${delivery.attempts} attempts` : undefined)}>
                        {delivery.target} {DELIVERY_TEXT[delivery.status] ?? delivery.status}
                      </Chip>
                    ))}
                  </div>
                ) : null}
                {failed.length > 0 && failed[0]?.error_message ? <p className="al-event-why s-major">{failed[0].error_message}</p> : null}
              </div>
            )
          })}
        </div>
      )}
      {nextCursor || !isFirstPage ? (
        <div className="card-f">
          {!isFirstPage ? (
            <ButtonLink href={href({ cursor: null })} size="sm" scroll={false}>
              Newest events
            </ButtonLink>
          ) : null}
          {nextCursor ? (
            <ButtonLink href={href({ cursor: nextCursor })} size="sm" scroll={false}>
              Older events
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
