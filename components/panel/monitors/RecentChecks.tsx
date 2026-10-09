'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { Select } from '@/components/ui/Field'
import type { CheckResultResource } from '@/lib/domain/schemas/monitors'
import { formatDateTime, formatMs } from '@/lib/format'
import { RESULT_LABELS, ResultCode, regionCode, regionName } from './shared'

interface Props {
  checks: CheckResultResource[]
  nextCursor: string | null
  isFirstPage: boolean
  regions: string[]
  region: string | null
  status: string | null
  timeZone: string
  threshold: number | null
}

const COLUMNS = 'minmax(130px, 0.9fr) minmax(110px, 0.8fr) minmax(100px, 0.7fr) 64px minmax(80px, 0.6fr) minmax(200px, 2fr)'

function detail(check: CheckResultResource): string {
  if (check.error) return check.error
  const details = check.details ?? {}
  if (typeof details.failed_assertion === 'string') return details.failed_assertion
  if (typeof details.message === 'string') return details.message
  if (typeof details.ip === 'string') return `Resolved to ${details.ip}`
  if (Array.isArray(details.answers)) return `Answer: ${(details.answers as unknown[]).slice(0, 3).join(', ')}`
  return ''
}

export function RecentChecks({ checks, nextCursor, isFirstPage, regions, region, status, timeZone, threshold }: Props) {
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
    <Card aria-label="Recent checks">
      <CardHeader
        title="Recent checks"
        description="Every probe result, newest first. Probe errors never count against the monitor."
        actions={
          <div className="row" style={{ ['--gap' as string]: '8px' }}>
            {regions.length > 1 ? (
              <Select
                aria-label="Filter by region"
                value={region ?? ''}
                onChange={(event) => filter({ region: event.target.value || null })}
                options={[{ value: '', label: 'All regions' }, ...regions.map((id) => ({ value: id, label: regionName(id) }))]}
              />
            ) : null}
            <Select
              aria-label="Filter by result"
              value={status ?? ''}
              onChange={(event) => filter({ status: event.target.value || null })}
              options={[
                { value: '', label: 'All results' },
                { value: 'down', label: 'Failed' },
                { value: 'degraded', label: 'Slow' },
                { value: 'up', label: 'Passed' },
                { value: 'error', label: 'Probe errors' },
              ]}
            />
          </div>
        }
      />
      {checks.length === 0 ? (
        <EmptyState title={region || status ? 'No checks match' : 'No checks yet'} description={region || status ? 'Try another region or result.' : 'The first results appear within a minute of creating or resuming the monitor.'} />
      ) : (
        <div className="tbl-scroll">
          <div className="tbl" role="table" aria-label="Check results" style={{ ['--cols' as string]: COLUMNS, minWidth: 820 }}>
            <div className="tr th" role="row">
              <span role="columnheader">Time</span>
              <span role="columnheader">Region</span>
              <span role="columnheader">Result</span>
              <span role="columnheader">Code</span>
              <span role="columnheader">Response</span>
              <span role="columnheader">Detail</span>
            </div>
            {checks.map((check) => (
              <div className="tr" role="row" key={check.id}>
                <span role="cell" className="num" style={{ fontSize: 13 }}>
                  {formatDateTime(check.checked_at, { timeZone })}
                </span>
                <span role="cell" style={{ fontSize: 13 }}>
                  {regionName(check.region)} <span className="mono faint" style={{ fontSize: 11.5 }}>{regionCode(check.region)}</span>
                </span>
                <span role="cell" className={check.status === 'down' ? 's-major' : check.status === 'degraded' ? 's-degraded' : check.status === 'error' ? 'muted' : 's-operational'} style={{ fontSize: 13, fontWeight: 600 }}>
                  {RESULT_LABELS[check.status]}
                </span>
                <span role="cell">
                  <ResultCode result={check} />
                </span>
                <span role="cell" className={['mono num', threshold && (check.latency_ms ?? 0) > threshold ? 's-degraded' : ''].join(' ')} style={{ fontSize: 12.5 }}>
                  {formatMs(check.latency_ms)}
                </span>
                <span role="cell" className="truncate muted" style={{ fontSize: 12.5 }} title={detail(check)}>
                  {detail(check) || <span className="faint">—</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {nextCursor || !isFirstPage ? (
        <div className="card-f">
          {!isFirstPage ? (
            <ButtonLink href={href({ cursor: null })} size="sm" scroll={false}>
              Newest checks
            </ButtonLink>
          ) : (
            <span />
          )}
          {nextCursor ? (
            <ButtonLink href={href({ cursor: nextCursor })} size="sm" scroll={false}>
              Older checks
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
