'use client'

import { useState } from 'react'
import { PLAN_INFO, PLANS, type Plan } from '@shared/plans.ts'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, Meter } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Segmented } from '@/components/ui/Segmented'
import { Chip } from '@/components/ui/Status'
import { CheckIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'

export interface UsageRow {
  label: string
  used: number
  limit: number
}

interface Props {
  organization: { id: string; name: string; plan: Plan }
  isOwner: boolean
  billingReady: boolean
  usage: UsageRow[]
  effects: Record<Plan, string[]>
}

export function BillingManager({ organization, isOwner, billingReady, usage, effects }: Props) {
  const [cadence, setCadence] = useState<'monthly' | 'yearly'>('monthly')
  const [target, setTarget] = useState<Plan | null>(null)
  const { run, pending } = useAction()
  const current = organization.plan
  const rank = (plan: Plan) => PLANS.indexOf(plan)

  const change = async () => {
    if (!target) return
    const result = await run(() => appRequest<{ paused_monitors: number; resumed_monitors: number }>('/billing/plan', { body: { organization_id: organization.id, plan: target, interval: cadence } }), {
      success: `You are on ${PLAN_INFO[target].name}`,
    })
    if (result) setTarget(null)
  }

  return (
    <div className="settings-grid">
      <Card>
        <CardHeader
          title="Plan"
          description={`${organization.name} is on ${PLAN_INFO[current].name}. ${isOwner ? 'Changes apply right away.' : 'Only owners can change the plan.'}`}
          actions={
            <Segmented<'monthly' | 'yearly'>
              label="Billing interval"
              value={cadence}
              onChange={setCadence}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />
          }
        />
        <div className="card-b stack">
          {!billingReady && isOwner ? <Banner tone="info">Payments are not connected in this environment. Plan changes are disabled until billing is set up.</Banner> : null}
          <div className="plans">
            {PLANS.map((plan) => {
              const info = PLAN_INFO[plan]
              const price = cadence === 'yearly' ? info.yearly : info.monthly
              const isCurrent = plan === current
              return (
                <div key={plan} className={['plan', isCurrent ? 'current' : ''].join(' ')}>
                  <h3>
                    {info.name}
                    {isCurrent ? <Chip tone="accent">Current plan</Chip> : null}
                  </h3>
                  <span className="plan-price">
                    ${price}
                    <small> per month{cadence === 'yearly' && price > 0 ? ', billed yearly' : ''}</small>
                  </span>
                  <span className="help">{info.summary}</span>
                  <ul>
                    {info.highlights.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <Button disabled icon={<CheckIcon size={14} />}>
                      Your plan
                    </Button>
                  ) : (
                    <Button variant={rank(plan) > rank(current) ? 'primary' : 'ghost'} disabled={!isOwner || !billingReady} onClick={() => setTarget(plan)}>
                      {rank(plan) > rank(current) ? `Upgrade to ${info.name}` : `Move to ${info.name}`}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Usage" description="What this organization uses against the limits of its plan." />
        <div className="usage">
          {usage.map((row) => {
            const percent = row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0
            return (
              <div key={row.label} className="usage-item">
                <span className="spread">
                  <span>{row.label}</span>
                  <span className="num">
                    {row.used.toLocaleString('en-US')}
                    <span className="faint"> / {row.limit === -1 ? 'unlimited' : row.limit.toLocaleString('en-US')}</span>
                  </span>
                </span>
                {row.limit > 0 ? <Meter value={percent} tone={percent >= 100 ? 'bad' : percent >= 80 ? 'warn' : 'ok'} label={`${row.label}: ${percent}% of the plan`} /> : null}
              </div>
            )
          })}
        </div>
      </Card>

      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? (rank(target) > rank(current) ? `Upgrade to ${PLAN_INFO[target].name}?` : `Move to ${PLAN_INFO[target].name}?`) : 'Change plan'}
        description={target ? `$${cadence === 'yearly' ? PLAN_INFO[target].yearly : PLAN_INFO[target].monthly} per month${cadence === 'yearly' ? ', billed yearly' : ''}.` : undefined}
        onSubmit={() => void change()}
        footer={
          <>
            <Button onClick={() => setTarget(null)}>Cancel</Button>
            <Button type="submit" variant={target && rank(target) < rank(current) ? 'danger' : 'primary'} loading={pending}>
              {target ? (rank(target) > rank(current) ? `Upgrade to ${PLAN_INFO[target].name}` : `Move to ${PLAN_INFO[target].name}`) : 'Change plan'}
            </Button>
          </>
        }
      >
        {target ? (
          effects[target].length > 0 ? (
            <ul className="stack" style={{ ['--gap' as string]: '8px', paddingLeft: 18, margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
              {effects[target].map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          ) : (
            <p className="help">Nothing you use today changes.</p>
          )
        ) : null}
      </Dialog>
    </div>
  )
}
