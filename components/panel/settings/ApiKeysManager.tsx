'use client'

import { useState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { CodeBlock, SecretValue } from '@/components/ui/Code'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Chip } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import { KeyIcon, PlusIcon, RefreshIcon, TrashIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { ApiKeyAccess, ApiKeyResource, RotationGrace } from '@/lib/domain/schemas/api-keys'
import { formatDate } from '@/lib/format'

interface Props {
  organization: { id: string; name: string; personal: boolean }
  keys: ApiKeyResource[]
  projects: Array<{ id: string; name: string; slug: string }>
  apiAllowed: boolean
  apiUrl: string
}

const GRACE_LABELS: Record<RotationGrace, string> = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days' }

export function ApiKeysManager({ organization, keys, projects, apiAllowed, apiUrl }: Props) {
  const confirm = useConfirm()
  const { run, pending, fieldErrors } = useAction()
  const [dialog, setDialog] = useState(false)
  const [name, setName] = useState('')
  const [access, setAccess] = useState<ApiKeyAccess>('read')
  const [projectId, setProjectId] = useState('')
  const [expiry, setExpiry] = useState('')
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null)
  const [rotating, setRotating] = useState<ApiKeyResource | null>(null)
  const [grace, setGrace] = useState<RotationGrace>('24h')

  const reset = () => {
    setDialog(false)
    setCreated(null)
    setName('')
    setAccess('read')
    setProjectId('')
    setExpiry('')
  }

  const create = async () => {
    const result = await run(
      () =>
        appRequest<{ key: ApiKeyResource; token: string }>('/api-keys', {
          body: { organization_id: organization.id, name: name.trim(), access, project_id: projectId || null, expires_in_days: expiry ? Number(expiry) : null },
        }),
      { success: 'API key created' },
    )
    if (result) setCreated({ token: result.token, name: result.key.name })
  }

  const rotate = async () => {
    if (!rotating) return
    const result = await run(() => appRequest<{ key: ApiKeyResource; token: string }>(`/api-keys/${rotating.id}/rotate`, { body: { grace } }), {
      success: 'Key rotated',
      successDescription: `The old key keeps working for ${GRACE_LABELS[grace]}.`,
    })
    if (result) {
      setRotating(null)
      setCreated({ token: result.token, name: result.key.name })
      setDialog(true)
    }
  }

  const revoke = async (key: ApiKeyResource) => {
    const ok = await confirm({
      title: `Revoke ${key.name}?`,
      description: 'Requests with this key fail right away. Scripts, CI jobs and Terraform runs that use it stop working.',
      confirmLabel: 'Revoke key',
      requireText: key.name,
    })
    if (ok) await run(() => appRequest(`/api-keys/${key.id}`, { method: 'DELETE' }), { success: 'Key revoked' })
  }

  const active = keys.filter((key) => key.status === 'active')
  const inactive = keys.filter((key) => key.status !== 'active')

  return (
    <div className="settings-grid">
      {!apiAllowed ? (
        <Banner tone="info" action={<ButtonLink size="sm" href="/settings/billing">See plans</ButtonLink>}>
          The API, the Terraform provider, the CLI and the GitHub Action are part of the Pro plan. Existing keys stop working on the Free plan.
        </Banner>
      ) : null}

      <Card>
        <CardHeader
          title="API keys"
          description={`Keys act for ${organization.personal ? 'your personal workspace' : organization.name}. Upvane stores only a hash: copy a key when you create it.`}
          actions={
            <Button variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={() => setDialog(true)} disabled={!apiAllowed}>
              Create key
            </Button>
          }
        />
        {keys.length === 0 ? (
          <EmptyState title="No API keys yet" description="Create a read key for dashboards and reports, or a write key for CI, Terraform and incident automation." />
        ) : (
          <div className="tbl-scroll">
            <div className="tbl" role="table" aria-label="API keys" style={{ ['--cols' as string]: 'minmax(200px, 1.5fr) 110px minmax(140px, 1fr) minmax(120px, 0.9fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) 150px', minWidth: 1000 }}>
              <div className="tr th" role="row">
                <span role="columnheader">Key</span>
                <span role="columnheader">Access</span>
                <span role="columnheader">Status pages</span>
                <span role="columnheader">Created</span>
                <span role="columnheader">Last used</span>
                <span role="columnheader">Expires</span>
                <span role="columnheader">
                  <span className="sr-only">Actions</span>
                </span>
              </div>
              {[...active, ...inactive].map((key) => (
                <div className={['tr', key.status === 'active' ? 'hoverable' : ''].join(' ')} role="row" key={key.id} style={key.status === 'active' ? undefined : { opacity: 0.6 }}>
                  <span role="cell" className="stack" style={{ ['--gap' as string]: '2px' }}>
                    <span style={{ fontWeight: 550 }}>{key.name}</span>
                    <span className="mono faint" style={{ fontSize: 12 }}>
                      {key.prefix ? `${key.prefix}…` : 'legacy key'}
                    </span>
                  </span>
                  <span role="cell">{key.scopes.includes('write') ? <Chip tone="warning">Read and write</Chip> : <Chip>Read only</Chip>}</span>
                  <span role="cell" className="truncate" style={{ fontSize: 13 }}>
                    {key.project ? key.project.name : 'All status pages'}
                  </span>
                  <span role="cell" className="stack" style={{ ['--gap' as string]: '2px', fontSize: 13 }}>
                    <span>{formatDate(key.created_at)}</span>
                    {key.created_by ? <span className="faint" style={{ fontSize: 12 }}>by {key.created_by.name}</span> : null}
                  </span>
                  <span role="cell" style={{ fontSize: 13 }}>
                    <RelativeTime value={key.last_used_at} fallback="Never" />
                  </span>
                  <span role="cell" style={{ fontSize: 13 }}>
                    {key.status === 'revoked' ? <span className="faint">Revoked</span> : key.status === 'expired' ? <span className="s-major">Expired</span> : key.expires_at ? formatDate(key.expires_at) : 'Never'}
                  </span>
                  <span role="cell" className="row" style={{ ['--gap' as string]: '4px', justifyContent: 'flex-end' }}>
                    {key.status === 'active' ? (
                      <>
                        <Button size="sm" variant="quiet" icon={<RefreshIcon size={14} />} onClick={() => setRotating(key)} disabled={!apiAllowed}>
                          Rotate
                        </Button>
                        <Button size="sm" variant="quiet" iconOnly icon={<TrashIcon size={14} />} aria-label={`Revoke ${key.name}`} onClick={() => void revoke(key)} />
                      </>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Use a key" description="Send it as a bearer token. Write requests accept an Idempotency-Key header so retries are safe." />
        <div className="card-b">
          <CodeBlock language="shell" code={`curl ${apiUrl}/me \\\n  -H "Authorization: Bearer $UPVANE_API_KEY"`} />
        </div>
      </Card>

      <Dialog
        open={dialog}
        onClose={reset}
        title={created ? `Copy the key for ${created.name}` : 'Create API key'}
        description={created ? 'This is the only time Upvane shows it. Store it in your secret manager or CI secrets.' : 'Give each integration its own key, so you can rotate or revoke it alone.'}
        onSubmit={created ? undefined : () => void create()}
        footer={
          created ? (
            <Button variant="primary" onClick={reset}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={reset}>Cancel</Button>
              <Button type="submit" variant="primary" loading={pending} icon={<KeyIcon size={14} />}>
                Create key
              </Button>
            </>
          )
        }
      >
        {created ? (
          <div className="stack">
            <SecretValue value={created.token} />
            <CodeBlock language="shell" code={`export UPVANE_API_KEY=${created.token}`} />
          </div>
        ) : (
          <div className="stack">
            <Field label="Name" hint="What uses it, such as GitHub Actions deploy or Terraform." error={fieldErrors.name}>
              {(props) => <Input {...props} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus placeholder="GitHub Actions deploy" />}
            </Field>
            <Field label="Access">
              {(props) => (
                <div id={props.id} className="stack" style={{ ['--gap' as string]: '6px' }}>
                  <Segmented<ApiKeyAccess>
                    label="Access"
                    value={access}
                    onChange={setAccess}
                    options={[
                      { value: 'read', label: 'Read only' },
                      { value: 'write', label: 'Read and write' },
                    ]}
                  />
                  <span className="help">{access === 'read' ? 'Reads status, incidents, monitors and metrics.' : 'Also declares incidents, schedules maintenance and changes configuration, like an admin.'}</span>
                </div>
              )}
            </Field>
            <div className="mf-grid">
              <Field label="Status pages" error={fieldErrors.project_id}>
                {(props) => <Select {...props} value={projectId} onChange={(event) => setProjectId(event.target.value)} options={[{ value: '', label: 'All status pages' }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} />}
              </Field>
              <Field label="Expires" error={fieldErrors.expires_in_days}>
                {(props) => (
                  <Select
                    {...props}
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                    options={[
                      { value: '', label: 'Never' },
                      { value: '30', label: 'In 30 days' },
                      { value: '90', label: 'In 90 days' },
                      { value: '365', label: 'In a year' },
                    ]}
                  />
                )}
              </Field>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={rotating !== null}
        onClose={() => setRotating(null)}
        title={rotating ? `Rotate ${rotating.name}?` : 'Rotate key'}
        description="Upvane creates a new key with the same access. The old one keeps working for a while so you can roll out the new one."
        onSubmit={() => void rotate()}
        footer={
          <>
            <Button onClick={() => setRotating(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>
              Rotate key
            </Button>
          </>
        }
      >
        <Field label="Old key keeps working for">
          {(props) => (
            <div id={props.id}>
              <Segmented<RotationGrace> label="Grace period" value={grace} onChange={setGrace} options={(Object.keys(GRACE_LABELS) as RotationGrace[]).map((value) => ({ value, label: GRACE_LABELS[value] }))} />
            </div>
          )}
        </Field>
      </Dialog>
    </div>
  )
}
