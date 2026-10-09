'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useRef, useState } from 'react'
import type { MonitorState } from '@shared/domain.ts'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { Sparkline } from '@/components/ui/Charts'
import { useConfirm } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/Field'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Segmented } from '@/components/ui/Segmented'
import { RelativeTime } from '@/components/ui/Time'
import { HeartbeatIcon, MoreIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, RefreshIcon, TrashIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { MonitorResource, MonitorRunResource } from '@/lib/domain/schemas/monitors'
import { formatUptime } from '@/lib/format'
import { intervalLabel, MonitorStateLabel, monitorTarget, regionCode, summarizeRun } from './shared'

export type StateFilter = 'all' | 'down' | 'degraded' | 'up' | 'paused'

export interface MonitorRowSummary {
  availability: number | null
  p95_latency_ms: number | null
  latency_buckets: Array<number | null>
}

interface Props {
  projectId: string
  monitors: MonitorResource[]
  counts: Record<MonitorState | 'all', number>
  regionStates: Record<string, Array<{ region: string; confirmed: 'up' | 'degraded' | 'down' }>>
  summaries: Record<string, MonitorRowSummary>
  filter: StateFilter
  search: string
  canEdit: boolean
  canRun: boolean
  monitorLimit: number
}

const COLUMNS = 'minmax(240px, 2fr) minmax(130px, 0.9fr) minmax(150px, 1fr) minmax(130px, 0.9fr) minmax(170px, 1.1fr) 40px'

export function MonitorsList({ projectId, monitors, counts, regionStates, summaries, filter, search, canEdit, canRun, monitorLimit }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const confirm = useConfirm()
  const { run } = useAction()
  const toast = useToast()
  const [query, setQuery] = useState(search)
  const [running, setRunning] = useState<string | null>(null)
  const base = `/projects/${projectId}/monitors`

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, { scroll: false })
  }

  // Debounced search in the URL so the list stays shareable.
  const timer = useRef<number | null>(null)
  const onSearch = (value: string) => {
    setQuery(value)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => navigate({ q: value.trim() || null }), 300)
  }

  const runNow = async (monitor: MonitorResource) => {
    setRunning(monitor.id)
    const result = await run(() => appRequest<MonitorRunResource>(`${base}/${monitor.id}/run`, { method: 'POST' }))
    setRunning(null)
    if (result) toast.success(`${monitor.name} checked`, summarizeRun(result.results))
  }

  const toggle = (monitor: MonitorResource) =>
    run(() => appRequest(`${base}/${monitor.id}`, { method: 'PATCH', body: { enabled: !monitor.enabled } }), {
      success: monitor.enabled ? 'Monitor paused' : 'Monitor resumed',
      successDescription: monitor.enabled ? 'No checks or alerts until you resume it.' : 'The next check runs within a minute.',
    })

  const remove = async (monitor: MonitorResource) => {
    const ok = await confirm({
      title: `Delete ${monitor.name}?`,
      description: 'Its check history goes with it. Components it sets go back to their other status sources.',
      confirmLabel: 'Delete monitor',
    })
    if (ok) await run(() => appRequest(`${base}/${monitor.id}`, { method: 'DELETE' }), { success: 'Monitor deleted' })
  }

  const filterOptions: Array<{ value: StateFilter; label: string }> = [
    { value: 'all', label: `All ${counts.all}` },
    { value: 'down', label: `Down ${counts.down}` },
    { value: 'degraded', label: `Degraded ${counts.degraded}` },
    { value: 'up', label: `Up ${counts.up}` },
    { value: 'paused', label: `Paused ${counts.paused}` },
  ]

  if (counts.all === 0) {
    return (
      <Card>
        <EmptyState
          title="No monitors yet"
          description="Monitors check your services from several regions and set component status on their own. Start with the health endpoint of your API, or a heartbeat for a cron job."
          action={
            canEdit ? (
              <div className="row" style={{ ['--gap' as string]: '10px', justifyContent: 'center' }}>
                <ButtonLink href={`/p/${projectId}/monitors/new`} variant="primary" icon={<PlusIcon size={14} />}>
                  Add monitor
                </ButtonLink>
                <ButtonLink href={`/p/${projectId}/monitors/new?type=heartbeat`} icon={<HeartbeatIcon size={14} />}>
                  Add heartbeat
                </ButtonLink>
              </div>
            ) : null
          }
          center
        />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={`${counts.all} monitor${counts.all === 1 ? '' : 's'}`}
        description={monitorLimit === -1 ? 'A problem needs confirmation from your regions before it changes status.' : `A problem needs confirmation before it changes status. Your plan includes ${monitorLimit} monitors across the organization.`}
        actions={
          canEdit ? (
            <ButtonLink href={`/p/${projectId}/monitors/new`} variant="primary" size="sm" icon={<PlusIcon size={14} />}>
              Add monitor
            </ButtonLink>
          ) : null
        }
      />
      <div className="mon-filters">
        <Segmented<StateFilter> label="Filter by state" options={filterOptions} value={filter} onChange={(value) => navigate({ state: value === 'all' ? null : value })} />
        <Input type="search" placeholder="Search by name" aria-label="Search monitors by name" value={query} onChange={(event) => onSearch(event.target.value)} />
      </div>
      {monitors.length === 0 ? (
        <EmptyState
          title="No monitors match"
          description={search ? `Nothing named like "${search}" in this view.` : 'No monitor is in this state right now.'}
          action={
            <Button
              onClick={() => {
                setQuery('')
                navigate({ state: null, q: null })
              }}
            >
              Show all monitors
            </Button>
          }
        />
      ) : (
        <div className="tbl-scroll">
          <div className="tbl" role="table" aria-label="Monitors" style={{ ['--cols' as string]: COLUMNS, minWidth: 960 }}>
            <div className="tr th" role="row">
              <span role="columnheader">Monitor</span>
              <span role="columnheader">State</span>
              <span role="columnheader">Regions</span>
              <span role="columnheader">Last check</span>
              <span role="columnheader">Last 24 hours</span>
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            </div>
            {monitors.map((monitor) => {
              const summary = summaries[monitor.id]
              const regions = monitor.type === 'heartbeat' ? [] : monitor.regions
              const confirmed = new Map((regionStates[monitor.id] ?? []).map((row) => [row.region, row.confirmed]))
              const latency = (summary?.latency_buckets ?? []).filter((value): value is number => value !== null)
              return (
                <div className="tr hoverable" role="row" key={monitor.id}>
                  <span role="cell" className="mon-name">
                    <Link className="rowlink" href={`/p/${projectId}/monitors/${monitor.id}`}>
                      {monitor.name}
                    </Link>
                    <span className="mon-target" title={monitorTarget(monitor)}>
                      {monitorTarget(monitor)}
                    </span>
                  </span>
                  <span role="cell" className="stack" style={{ ['--gap' as string]: '3px' }}>
                    <MonitorStateLabel state={monitor.state} enabled={monitor.enabled} pausedReason={monitor.paused_reason} />
                    {monitor.enabled && monitor.state_changed_at && monitor.state !== 'pending' ? (
                      <span className="faint" style={{ fontSize: 12 }}>
                        Changed <RelativeTime value={monitor.state_changed_at} />
                      </span>
                    ) : null}
                  </span>
                  <span role="cell">
                    {regions.length === 0 ? (
                      <span className="faint" style={{ fontSize: 13 }}>
                        {monitor.type === 'heartbeat' ? 'Push' : '—'}
                      </span>
                    ) : (
                      <span className="mon-regions">
                        {regions.slice(0, 5).map((region) => {
                          const state = confirmed.get(region)
                          return (
                            <span key={region} className={['mon-region', state === 'down' ? 'r-down' : state === 'degraded' ? 'r-degraded' : ''].join(' ')} title={region}>
                              {regionCode(region)}
                            </span>
                          )
                        })}
                        {regions.length > 5 ? <span className="mon-region">+{regions.length - 5}</span> : null}
                      </span>
                    )}
                  </span>
                  <span role="cell" className="stack" style={{ ['--gap' as string]: '2px', fontSize: 13 }}>
                    <RelativeTime value={monitor.type === 'heartbeat' ? monitor.last_heartbeat_at : monitor.last_checked_at} fallback="Not yet" />
                    <span className="faint" style={{ fontSize: 12 }}>
                      {intervalLabel(monitor.interval_seconds)}
                    </span>
                  </span>
                  <span role="cell" className="mon-avail">
                    <span className="row" style={{ ['--gap' as string]: '8px' }}>
                      <span className="num">{summary?.availability === null || summary === undefined ? '—' : formatUptime(summary.availability)}</span>
                      {summary?.p95_latency_ms ? <span className="faint num" style={{ fontSize: 12 }}>p95 {summary.p95_latency_ms} ms</span> : null}
                    </span>
                    {latency.length > 1 ? <Sparkline values={latency} height={22} label={`Hourly average response time of ${monitor.name}`} /> : null}
                  </span>
                  <span role="cell">
                    {canRun ? (
                      <Menu
                        label={`Actions for ${monitor.name}`}
                        trigger={(props) => (
                          <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label={`Actions for ${monitor.name}`} {...props}>
                            <MoreIcon size={16} />
                          </button>
                        )}
                      >
                        {(close) => (
                          <>
                            {monitor.type !== 'heartbeat' ? (
                              <MenuItem
                                icon={<RefreshIcon size={14} />}
                                disabled={running === monitor.id || !monitor.enabled}
                                onSelect={() => {
                                  close()
                                  void runNow(monitor)
                                }}
                              >
                                {running === monitor.id ? 'Running…' : 'Run now'}
                              </MenuItem>
                            ) : null}
                            {canEdit ? (
                              <>
                                <MenuItem icon={<PencilIcon size={14} />} onSelect={() => { close(); router.push(`/p/${projectId}/monitors/${monitor.id}/edit`) }}>
                                  Edit
                                </MenuItem>
                                <MenuItem icon={monitor.enabled ? <PauseIcon size={14} /> : <PlayIcon size={14} />} onSelect={() => { close(); void toggle(monitor) }}>
                                  {monitor.enabled ? 'Pause' : 'Resume'}
                                </MenuItem>
                                <MenuItem icon={<TrashIcon size={14} />} danger onSelect={() => { close(); void remove(monitor) }}>
                                  Delete
                                </MenuItem>
                              </>
                            ) : null}
                          </>
                        )}
                      </Menu>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}
