'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useRef, useState } from 'react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState, Kpi } from '@/components/ui/Card'
import { SecretValue } from '@/components/ui/Code'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Chip } from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import { RelativeTime } from '@/components/ui/Time'
import { DownloadIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { SubscriberAddResult, SubscriberCounts, SubscriberResource } from '@/lib/domain/schemas/subscribers'
import { formatDate } from '@/lib/format'

type Kind = 'email' | 'slack' | 'webhook'

interface Props {
  projectId: string
  subscribers: SubscriberResource[]
  counts: SubscriberCounts
  nextCursor: string | null
  isFirstPage: boolean
  filters: { type: string | null; status: string | null; q: string }
  components: Array<{ id: string; name: string }>
  canEdit: boolean
}

const TYPE_LABELS: Record<Kind, string> = { email: 'Email', slack: 'Slack', webhook: 'Webhook' }
const OUTCOME_TEXT: Record<string, string> = {
  confirmation_sent: 'They get an email to confirm. Updates start after they click it.',
  already_confirmed: 'This address was already subscribed.',
  subscribed: 'Updates start with the next incident or maintenance.',
}

export function SubscribersManager({ projectId, subscribers, counts, nextCursor, isFirstPage, filters, components, canEdit }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const confirm = useConfirm()
  const { run, pending, fieldErrors } = useAction()
  const toast = useToast()
  const [query, setQuery] = useState(filters.q)
  const timer = useRef<number | null>(null)
  const [dialog, setDialog] = useState(false)
  const [kind, setKind] = useState<Kind>('email')
  const [target, setTarget] = useState('')
  const [allComponents, setAllComponents] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [signed, setSigned] = useState(true)
  const [secret, setSecret] = useState<string | null>(null)
  const names = new Map(components.map((component) => [component.id, component.name]))

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    return next.size > 0 ? `${pathname}?${next}` : pathname
  }
  const filter = (changes: Record<string, string | null>) => router.replace(href({ ...changes, cursor: null }), { scroll: false })
  const onSearch = (value: string) => {
    setQuery(value)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => filter({ q: value.trim() || null }), 300)
  }

  const close = () => {
    setDialog(false)
    setSecret(null)
    setTarget('')
    setSelected([])
    setAllComponents(true)
  }

  const add = async () => {
    const component_ids = allComponents ? [] : selected
    const body = kind === 'email' ? { type: kind, email: target.trim(), component_ids } : kind === 'slack' ? { type: kind, webhook_url: target.trim(), component_ids } : { type: kind, url: target.trim(), generate_signing_secret: signed, component_ids }
    const result = await run(() => appRequest<SubscriberAddResult & { signing_secret?: string }>(`/projects/${projectId}/subscribers`, { body }))
    if (!result) return
    toast.success(result.outcome === 'already_confirmed' ? 'Already subscribed' : 'Subscriber added', OUTCOME_TEXT[result.outcome])
    if (result.signing_secret) setSecret(result.signing_secret)
    else close()
  }

  const remove = async (subscriber: SubscriberResource) => {
    const label = subscriber.email ?? subscriber.target_hint ?? 'this subscriber'
    const ok = await confirm({ title: `Remove ${label}?`, description: 'They stop getting updates right away. They can subscribe again from the status page.', confirmLabel: 'Remove subscriber' })
    if (ok) await run(() => appRequest(`/projects/${projectId}/subscribers/${subscriber.id}`, { method: 'DELETE' }), { success: 'Subscriber removed' })
  }

  const limitText = counts.limit === -1 ? 'No limit on your plan' : `${counts.total} of ${counts.limit.toLocaleString('en-US')} on your plan`

  return (
    <>
      <Card>
        <div className="kpis">
          <Kpi label="Subscribers" value={counts.total.toLocaleString('en-US')} note={limitText} />
          <Kpi label="Confirmed" value={counts.confirmed.toLocaleString('en-US')} note="Get every public update" />
          <Kpi label="Waiting to confirm" value={counts.pending.toLocaleString('en-US')} note="Email not confirmed yet" />
          <Kpi label="By email" value={counts.email.toLocaleString('en-US')} note={`Plus ${counts.slack} Slack and ${counts.webhook} webhook`} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Subscribers"
          description="People and systems that get public incident and maintenance updates. Visitors subscribe from the status page."
          actions={
            <div className="row" style={{ ['--gap' as string]: '8px' }}>
              {canEdit ? (
                <ButtonLink href={`/api/app/projects/${projectId}/subscribers/export`} size="sm" icon={<DownloadIcon size={14} />} prefetch={false}>
                  Export CSV
                </ButtonLink>
              ) : null}
              {canEdit ? (
                <Button size="sm" variant="primary" icon={<PlusIcon size={14} />} onClick={() => setDialog(true)}>
                  Add subscriber
                </Button>
              ) : null}
            </div>
          }
        />
        <div className="al-filters" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div className="row row-wrap" style={{ ['--gap' as string]: '8px' }}>
            <Segmented<string>
              label="Filter by status"
              value={filters.status ?? 'all'}
              onChange={(value) => filter({ status: value === 'all' ? null : value })}
              options={[
                { value: 'all', label: 'All' },
                { value: 'confirmed', label: 'Confirmed' },
                { value: 'pending', label: 'Waiting' },
              ]}
            />
            <Select
              aria-label="Filter by channel"
              value={filters.type ?? ''}
              onChange={(event) => filter({ type: event.target.value || null })}
              options={[
                { value: '', label: 'Every channel' },
                { value: 'email', label: 'Email' },
                { value: 'slack', label: 'Slack' },
                { value: 'webhook', label: 'Webhook' },
              ]}
            />
          </div>
          <Input type="search" aria-label="Search subscribers" placeholder="Search email or URL" value={query} onChange={(event) => onSearch(event.target.value)} style={{ maxWidth: 260 }} />
        </div>
        {subscribers.length === 0 ? (
          <EmptyState
            title={filters.q || filters.type || filters.status ? 'No subscribers match' : 'No subscribers yet'}
            description={filters.q || filters.type || filters.status ? 'Try another filter.' : 'Visitors can subscribe from the status page by email, Slack or webhook. You can also add someone here.'}
          />
        ) : (
          <div className="tbl-scroll">
            <div className="tbl" role="table" aria-label="Subscribers" style={{ ['--cols' as string]: 'minmax(220px, 1.8fr) 90px minmax(150px, 1.2fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) 40px', minWidth: 940 }}>
              <div className="tr th" role="row">
                <span role="columnheader">Subscriber</span>
                <span role="columnheader">Channel</span>
                <span role="columnheader">Follows</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Since</span>
                <span role="columnheader">Last update</span>
                <span role="columnheader">
                  <span className="sr-only">Actions</span>
                </span>
              </div>
              {subscribers.map((subscriber) => (
                <div className="tr hoverable" role="row" key={subscriber.id}>
                  <span role="cell" className="truncate mono" style={{ fontSize: 13 }} title={subscriber.email ?? subscriber.target_hint ?? undefined}>
                    {subscriber.email ?? subscriber.target_hint ?? '—'}
                  </span>
                  <span role="cell" style={{ fontSize: 13 }}>
                    {TYPE_LABELS[subscriber.type as Kind] ?? subscriber.type}
                  </span>
                  <span role="cell" className="truncate" style={{ fontSize: 13 }}>
                    {subscriber.component_ids.length === 0
                      ? 'Everything'
                      : subscriber.component_ids
                          .map((id) => names.get(id) ?? 'Deleted component')
                          .slice(0, 3)
                          .join(', ') + (subscriber.component_ids.length > 3 ? ` +${subscriber.component_ids.length - 3}` : '')}
                  </span>
                  <span role="cell">{subscriber.confirmed ? <Chip tone="success">Confirmed</Chip> : <Chip tone="warning">Waiting</Chip>}</span>
                  <span role="cell" style={{ fontSize: 13 }}>
                    {formatDate(subscriber.created_at)}
                  </span>
                  <span role="cell" style={{ fontSize: 13 }}>
                    <RelativeTime value={subscriber.last_notified_at} fallback="None yet" />
                  </span>
                  <span role="cell">
                    {canEdit ? <Button variant="quiet" size="sm" iconOnly icon={<TrashIcon size={14} />} aria-label={`Remove ${subscriber.email ?? subscriber.target_hint ?? 'subscriber'}`} onClick={() => void remove(subscriber)} /> : null}
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
                First page
              </ButtonLink>
            ) : null}
            {nextCursor ? (
              <ButtonLink href={href({ cursor: nextCursor })} size="sm" scroll={false}>
                Next page
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Dialog
        open={dialog}
        onClose={close}
        title={secret ? 'Copy the signing secret' : 'Add subscriber'}
        description={secret ? 'The webhook receives an Upvane-Signature header made with this secret.' : 'Email subscribers you add here still confirm by email, unless they are members of your organization.'}
        onSubmit={secret ? undefined : () => void add()}
        footer={
          secret ? (
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button type="submit" variant="primary" loading={pending}>
                Add subscriber
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <SecretValue value={secret} />
        ) : (
          <div className="stack">
            <Segmented<Kind>
              label="Channel"
              value={kind}
              onChange={(value) => {
                setKind(value)
                setTarget('')
              }}
              options={[
                { value: 'email', label: 'Email' },
                { value: 'slack', label: 'Slack' },
                { value: 'webhook', label: 'Webhook' },
              ]}
            />
            <Field
              label={kind === 'email' ? 'Email address' : kind === 'slack' ? 'Slack webhook URL' : 'Endpoint URL'}
              error={fieldErrors.email ?? fieldErrors.webhook_url ?? fieldErrors.url}
              hint={kind === 'slack' ? 'An incoming webhook, such as https://hooks.slack.com/services/…' : kind === 'webhook' ? 'A public https endpoint that accepts JSON.' : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  className={kind === 'email' ? undefined : 'mono'}
                  type={kind === 'email' ? 'email' : 'url'}
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder={kind === 'email' ? 'name@example.com' : kind === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://example.com/hooks/status'}
                  autoFocus
                />
              )}
            </Field>
            {kind === 'webhook' ? <Checkbox label="Sign requests with an Upvane-Signature header" checked={signed} onChange={setSigned} /> : null}
            <Checkbox label="Every component" checked={allComponents} onChange={setAllComponents} />
            {!allComponents ? (
              <div className="mf-grid" style={{ maxHeight: 200, overflowY: 'auto' }}>
                {components.map((component) => (
                  <Checkbox key={component.id} label={component.name} checked={selected.includes(component.id)} onChange={(on) => setSelected((current) => (on ? [...current, component.id] : current.filter((id) => id !== component.id)))} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Dialog>
    </>
  )
}
