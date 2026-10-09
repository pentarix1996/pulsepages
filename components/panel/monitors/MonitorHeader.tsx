'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { MONITOR_TYPE_LABELS } from '@shared/domain.ts'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/Dialog'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Chip } from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import { ChevronRightIcon, MoreIcon, PauseIcon, PencilIcon, PlayIcon, RefreshIcon, TrashIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { MonitorResource, MonitorRunResource } from '@/lib/domain/schemas/monitors'
import { formatMs } from '@/lib/format'
import { intervalLabel, MonitorStateLabel, monitorTarget, RESULT_LABELS, ResultCode, regionName, summarizeRun } from './shared'

interface Props {
  projectId: string
  monitor: MonitorResource
  canEdit: boolean
  canRun: boolean
}

export function MonitorHeader({ projectId, monitor, canEdit, canRun }: Props) {
  const router = useRouter()
  const confirm = useConfirm()
  const toast = useToast()
  const { run, pending } = useAction()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MonitorRunResource | null>(null)
  const base = `/projects/${projectId}/monitors/${monitor.id}`
  const regions = monitor.type === 'heartbeat' ? 0 : monitor.regions.length

  const runNow = async () => {
    setRunning(true)
    setResult(null)
    const outcome = await run(() => appRequest<MonitorRunResource>(`${base}/run`, { method: 'POST' }))
    setRunning(false)
    if (outcome) {
      setResult(outcome)
      toast.success('Check finished', summarizeRun(outcome.results))
    }
  }

  const toggle = () =>
    run(() => appRequest(base, { method: 'PATCH', body: { enabled: !monitor.enabled } }), {
      success: monitor.enabled ? 'Monitor paused' : 'Monitor resumed',
      successDescription: monitor.enabled ? 'No checks or alerts until you resume it.' : 'The next check runs within a minute.',
    })

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${monitor.name}?`,
      description: 'Its check history goes with it. Components it sets go back to their other status sources.',
      confirmLabel: 'Delete monitor',
    })
    if (!ok) return
    const done = await run(() => appRequest(base, { method: 'DELETE' }).then(() => true), { success: 'Monitor deleted', refresh: false })
    if (done) router.push(`/p/${projectId}/monitors`)
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: '16px' }}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href={`/p/${projectId}/monitors`}>Monitors</Link>
        <ChevronRightIcon size={12} />
        <span>{monitor.name}</span>
      </nav>
      <div className="mon-head">
        <div className="mon-head-main">
          <div className="stack" style={{ ['--gap' as string]: '6px' }}>
            <h1 className="mon-h1">{monitor.name}</h1>
            <span className="mon-h1-target">{monitorTarget(monitor)}</span>
          </div>
          <div className="mon-chips">
            <Chip tone={!monitor.enabled ? 'neutral' : monitor.state === 'down' ? 'danger' : monitor.state === 'degraded' ? 'warning' : monitor.state === 'up' ? 'success' : 'neutral'}>
              <MonitorStateLabel state={monitor.state} enabled={monitor.enabled} pausedReason={monitor.paused_reason} />
            </Chip>
            <Chip>{MONITOR_TYPE_LABELS[monitor.type]}</Chip>
            <Chip>{monitor.type === 'heartbeat' ? `Expected ${intervalLabel(monitor.interval_seconds).toLowerCase()}` : intervalLabel(monitor.interval_seconds)}</Chip>
            {regions > 0 ? <Chip>{regions === 1 ? regionName(monitor.regions[0] ?? null) : `${regions} regions`}</Chip> : null}
            {monitor.components.length > 0 ? (
              <Chip>
                Sets
                {monitor.components.slice(0, 3).map((component, index) => (
                  <span key={component.component_id}>
                    {index > 0 ? ',' : ''}
                    <Link href={`/p/${projectId}/components`}>{component.name}</Link>
                  </span>
                ))}
                {monitor.components.length > 3 ? <span>+{monitor.components.length - 3}</span> : null}
              </Chip>
            ) : (
              <Chip>Sets no component</Chip>
            )}
          </div>
        </div>
        <div className="page-actions">
          {canEdit ? (
            <Button icon={monitor.enabled ? <PauseIcon size={14} /> : <PlayIcon size={14} />} onClick={() => void toggle()} disabled={pending && !running}>
              {monitor.enabled ? 'Pause' : 'Resume'}
            </Button>
          ) : null}
          {canEdit ? (
            <ButtonLink href={`/p/${projectId}/monitors/${monitor.id}/edit`} icon={<PencilIcon size={14} />}>
              Edit monitor
            </ButtonLink>
          ) : null}
          {canRun && monitor.type !== 'heartbeat' ? (
            <Button variant="primary" icon={<RefreshIcon size={14} />} loading={running} disabled={!monitor.enabled} onClick={() => void runNow()} title={monitor.enabled ? undefined : 'Resume the monitor to run it'}>
              {running ? 'Checking' : 'Run now'}
            </Button>
          ) : null}
          {canEdit ? (
            <Menu
              label="More actions"
              trigger={(props) => (
                <button type="button" className="btn btn-ghost btn-icon" aria-label="More actions" {...props}>
                  <MoreIcon size={16} />
                </button>
              )}
            >
              {(close) => (
                <MenuItem icon={<TrashIcon size={14} />} danger onSelect={() => { close(); void remove() }}>
                  Delete monitor
                </MenuItem>
              )}
            </Menu>
          ) : null}
        </div>
      </div>

      {monitor.paused_reason === 'plan_limit' ? (
        <Banner tone="warning" action={<ButtonLink href="/settings/billing" size="sm">See plans</ButtonLink>}>
          Upvane paused this monitor because your plan covers fewer monitors. Pause another one or upgrade, then resume it.
        </Banner>
      ) : monitor.enabled && monitor.state === 'down' && monitor.last_error ? (
        <Banner tone="danger">
          <strong>Last failure:</strong> {monitor.last_error}
        </Banner>
      ) : null}

      {result ? (
        <div className="run-results" aria-live="polite">
          {result.results.map((item) => (
            <div key={item.region} className={`run-result r-${item.status}`}>
              <span className="spread">
                <strong style={{ fontSize: 13.5 }}>{regionName(item.region)}</strong>
                <ResultCode result={item} />
              </span>
              <span className="spread" style={{ fontSize: 13 }}>
                <span className="muted">{RESULT_LABELS[item.status]}</span>
                <span className="mono num">{formatMs(item.latency_ms)}</span>
              </span>
              {item.error ? <span className="run-err">{item.error}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
