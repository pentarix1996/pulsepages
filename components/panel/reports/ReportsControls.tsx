'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState, Meter } from '@/components/ui/Card'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Segmented } from '@/components/ui/Segmented'
import { MoreIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { SloResource } from '@/lib/domain/schemas/metrics'
import { formatDuration } from '@/lib/format'

/** 7/30/90 days or a calendar month, in the URL. */
export function PeriodPicker({ period, month, months }: { period: string | null; month: string | null; months: Array<{ value: string; label: string; partial: boolean }> }) {
  const router = useRouter()
  const pathname = usePathname()
  const go = (params: Record<string, string>) => router.replace(`${pathname}?${new URLSearchParams(params)}`, { scroll: false })
  return (
    <div className="row row-wrap" style={{ ['--gap' as string]: '8px' }}>
      <Segmented<string>
        label="Period"
        value={month ? 'month' : (period ?? '30d')}
        onChange={(value) => (value === 'month' ? go({ month: months[1]?.value ?? months[0]!.value }) : go({ period: value }))}
        options={[
          { value: '7d', label: '7 days' },
          { value: '30d', label: '30 days' },
          { value: '90d', label: '90 days' },
          { value: 'month', label: 'Month' },
        ]}
      />
      {month ? <Select aria-label="Month" value={month} onChange={(event) => go({ month: event.target.value })} options={months.map((item) => ({ value: item.value, label: item.partial ? `${item.label} (to date)` : item.label }))} /> : null}
    </div>
  )
}

const WINDOWS = [7, 14, 28, 30, 90]

export function SlosCard({ projectId, slos, components, canEdit }: { projectId: string; slos: SloResource[]; components: Array<{ id: string; name: string }>; canEdit: boolean }) {
  const [editing, setEditing] = useState<SloResource | 'new' | null>(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('99.9')
  const [windowDays, setWindowDays] = useState('30')
  const [componentId, setComponentId] = useState('')
  const confirm = useConfirm()
  const { run, pending, fieldErrors } = useAction()
  const componentName = (id: string | null) => (id ? (components.find((component) => component.id === id)?.name ?? 'Deleted component') : 'Whole page')

  const open = (slo: SloResource | 'new') => {
    setEditing(slo)
    setName(slo === 'new' ? 'Availability' : slo.name)
    setTarget(slo === 'new' ? '99.9' : String(slo.target))
    setWindowDays(slo === 'new' ? '30' : String(slo.window_days))
    setComponentId(slo === 'new' ? '' : (slo.component_id ?? ''))
  }

  const save = async () => {
    const body = { name: name.trim(), target: Number(target), window_days: Number(windowDays), component_id: componentId || null }
    const saved = await run(
      () => (editing && editing !== 'new' ? appRequest(`/projects/${projectId}/slos/${editing.id}`, { method: 'PATCH', body }) : appRequest(`/projects/${projectId}/slos`, { body })),
      { success: editing === 'new' ? 'SLO added' : 'SLO saved' },
    )
    if (saved) setEditing(null)
  }

  const remove = async (slo: SloResource) => {
    const ok = await confirm({ title: `Delete the ${slo.name} SLO?`, description: 'The overview stops showing its error budget. Uptime history stays.', confirmLabel: 'Delete SLO' })
    if (ok) await run(() => appRequest(`/projects/${projectId}/slos/${slo.id}`, { method: 'DELETE' }), { success: 'SLO deleted' })
  }

  const allowed = (() => {
    const value = Number(target)
    const days = Number(windowDays)
    if (!Number.isFinite(value) || value <= 0 || value >= 100) return null
    return ((100 - value) / 100) * days * 86_400
  })()

  return (
    <Card id="slos" aria-label="Service level objectives">
      <CardHeader
        title="Service level objectives"
        description="A target availability over a rolling window. The error budget is the downtime the target allows."
        actions={
          canEdit ? (
            <Button size="sm" icon={<PlusIcon size={14} />} onClick={() => open('new')}>
              Add SLO
            </Button>
          ) : null
        }
      />
      {slos.length === 0 ? (
        <EmptyState title="No SLOs yet" description="Add one, such as 99.9% over 30 days, to see how much downtime you can still afford." action={canEdit ? <Button variant="primary" onClick={() => open('new')}>Add SLO</Button> : null} />
      ) : (
        <div className="rp-slos">
          {slos.map((slo) => {
            const budget = slo.budget_remaining === null ? null : Math.max(0, Math.round(slo.budget_remaining * 100))
            return (
              <div key={slo.id} className="rp-slo">
                <div className="rp-slo-head">
                  <div className="stack" style={{ ['--gap' as string]: '2px', minWidth: 0 }}>
                    <strong>{slo.name}</strong>
                    <span className="help">
                      {slo.target}% over {slo.window_days} days, {slo.component_id ? componentName(slo.component_id) : 'whole page'}
                    </span>
                  </div>
                  {canEdit ? (
                    <Menu
                      label={`Actions for ${slo.name}`}
                      trigger={(props) => (
                        <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label={`Actions for ${slo.name}`} {...props}>
                          <MoreIcon size={16} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem icon={<PencilIcon size={14} />} onSelect={() => { close(); open(slo) }}>
                            Edit
                          </MenuItem>
                          <MenuItem icon={<TrashIcon size={14} />} danger onSelect={() => { close(); void remove(slo) }}>
                            Delete
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  ) : null}
                </div>
                <div className="rp-slo-numbers">
                  <span>
                    <strong className={slo.actual !== null && slo.actual < slo.target ? 's-major' : undefined}>{slo.actual === null ? '—' : `${slo.actual.toFixed(3)}%`}</strong>
                    <span className="help">Measured</span>
                  </span>
                  <span>
                    <strong>{budget === null ? '—' : `${budget}%`}</strong>
                    <span className="help">Budget left</span>
                  </span>
                  <span>
                    <strong>{formatDuration(slo.consumed_downtime_seconds ?? 0, { compact: true })}</strong>
                    <span className="help">of {formatDuration(slo.allowed_downtime_seconds ?? 0, { compact: true })} allowed</span>
                  </span>
                </div>
                {budget !== null ? <Meter value={budget} tone={budget > 50 ? 'ok' : budget > 20 ? 'warn' : 'bad'} label={`${budget}% of the error budget left`} /> : null}
              </div>
            )
          })}
        </div>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add SLO' : 'Edit SLO'}
        onSubmit={() => void save()}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>
              {editing === 'new' ? 'Add SLO' : 'Save SLO'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label="Name" error={fieldErrors.name}>
            {(props) => <Input {...props} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <div className="mf-grid">
            <Field label="Target" hint="Percent, such as 99.9." error={fieldErrors.target}>
              {(props) => <Input {...props} type="number" step="0.001" min="1" max="99.999" value={target} onChange={(event) => setTarget(event.target.value)} />}
            </Field>
            <Field label="Window">
              {(props) => <Select {...props} value={windowDays} onChange={(event) => setWindowDays(event.target.value)} options={WINDOWS.map((days) => ({ value: String(days), label: `${days} days` }))} />}
            </Field>
          </div>
          <Field label="Measured on" error={fieldErrors.component_id}>
            {(props) => <Select {...props} value={componentId} onChange={(event) => setComponentId(event.target.value)} options={[{ value: '', label: 'Whole page (every component)' }, ...components.map((component) => ({ value: component.id, label: component.name }))]} />}
          </Field>
          {allowed !== null ? <p className="mf-sentence">This target allows {formatDuration(allowed)} of downtime every {windowDays} days.</p> : null}
        </div>
      </Dialog>
    </Card>
  )
}
