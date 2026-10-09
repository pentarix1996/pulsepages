'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Banner } from '@/components/ui/Banner'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { DownloadIcon } from '@/components/ui/icons'
import type { AuditEntryResource } from '@/lib/domain/schemas/organizations'
import { formatDateTime } from '@/lib/format'

interface Props {
  organizationId: string
  entries: AuditEntryResource[]
  nextCursor: string | null
  isFirstPage: boolean
  filters: { action: string; actor: string; from: string; to: string }
  groups: Array<{ value: string; label: string }>
  exportAllowed: boolean
}

const ACTOR_LABELS: Record<string, string> = { user: 'Person', api_key: 'API key', system: 'Upvane' }

function describe(entry: AuditEntryResource): string {
  const verb = entry.action.split('.').slice(1).join(' ').replace(/_/g, ' ')
  const area = entry.action.split('.')[0]?.replace(/_/g, ' ') ?? ''
  return `${area} ${verb}`.trim().replace(/^slo\b/, 'SLO').replace(/\bapi key\b/, 'API key')
}

export function AuditLogView({ organizationId, entries, nextCursor, isFirstPage, filters, groups, exportAllowed }: Props) {
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
  const exportQuery = new URLSearchParams({ organization: organizationId, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) })

  return (
    <div className="settings-grid">
      <Card>
        <CardHeader
          title="Audit log"
          description="Who changed what, from the dashboard, the API or Upvane itself. Entries are kept for a year."
          actions={
            exportAllowed ? (
              <ButtonLink size="sm" href={`/api/app/audit-log/export?${exportQuery}`} prefetch={false} icon={<DownloadIcon size={14} />}>
                Export CSV
              </ButtonLink>
            ) : null
          }
        />
        <div className="al-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <Select aria-label="Filter by area" value={filters.action} onChange={(event) => filter({ action: event.target.value || null })} options={[{ value: '', label: 'Every area' }, ...groups]} />
          <Select
            aria-label="Filter by actor"
            value={filters.actor}
            onChange={(event) => filter({ actor: event.target.value || null })}
            options={[
              { value: '', label: 'Everyone' },
              { value: 'user', label: 'People' },
              { value: 'api_key', label: 'API keys' },
              { value: 'system', label: 'Upvane' },
            ]}
          />
          <Input type="date" aria-label="From" value={filters.from} onChange={(event) => filter({ from: event.target.value || null })} style={{ maxWidth: 170 }} />
          <Input type="date" aria-label="To" value={filters.to} onChange={(event) => filter({ to: event.target.value || null })} style={{ maxWidth: 170 }} />
        </div>
        {!exportAllowed ? (
          <div style={{ padding: '14px 18px 0' }}>
            <Banner tone="info">Exporting the audit log as CSV is part of the Business plan.</Banner>
          </div>
        ) : null}
        {entries.length === 0 ? (
          <EmptyState title="Nothing logged" description={filters.action || filters.actor || filters.from || filters.to ? 'No entries match these filters.' : 'Changes to status pages, members, keys and billing appear here.'} />
        ) : (
          <div className="tbl-scroll">
            <div className="tbl" role="table" aria-label="Audit log" style={{ ['--cols' as string]: 'minmax(130px, 0.8fr) minmax(170px, 1.1fr) minmax(200px, 1.3fr) minmax(200px, 1.6fr)', minWidth: 900 }}>
              <div className="tr th" role="row">
                <span role="columnheader">Time</span>
                <span role="columnheader">Who</span>
                <span role="columnheader">What</span>
                <span role="columnheader">On</span>
              </div>
              {entries.map((entry) => (
                <div className="tr" role="row" key={entry.id}>
                  <span role="cell" className="num" style={{ fontSize: 13 }}>
                    {formatDateTime(entry.created_at)}
                  </span>
                  <span role="cell" className="stack" style={{ ['--gap' as string]: '2px', minWidth: 0 }}>
                    <span className="truncate" style={{ fontSize: 13.5 }}>
                      {entry.actor.label}
                    </span>
                    <span className="audit-row-meta">
                      {ACTOR_LABELS[entry.actor.type] ?? entry.actor.type}
                      {entry.ip ? ` from ${entry.ip}` : ''}
                    </span>
                  </span>
                  <span role="cell" className="stack" style={{ ['--gap' as string]: '2px', minWidth: 0 }}>
                    <span style={{ fontSize: 13.5 }}>{describe(entry).charAt(0).toUpperCase() + describe(entry).slice(1)}</span>
                    <span className="audit-action faint">{entry.action}</span>
                  </span>
                  <span role="cell" className="stack" style={{ ['--gap' as string]: '2px', minWidth: 0 }}>
                    <span className="truncate" style={{ fontSize: 13.5 }}>
                      {entry.target_label ?? entry.target_id ?? '—'}
                    </span>
                    {Object.keys(entry.metadata).length > 0 ? (
                      <span className="audit-row-meta truncate" title={JSON.stringify(entry.metadata)}>
                        {Object.entries(entry.metadata)
                          .slice(0, 3)
                          .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
                          .join(', ')}
                      </span>
                    ) : null}
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
                Newest
              </ButtonLink>
            ) : null}
            {nextCursor ? (
              <ButtonLink href={href({ cursor: nextCursor })} size="sm" scroll={false}>
                Older entries
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
