'use client'

import Link from 'next/link'
import { useState } from 'react'
import { COMPONENT_STATUS_LABELS, INBOUND_INTEGRATION_LABELS, INBOUND_INTEGRATION_TYPES, PROBLEM_STATUSES, type InboundIntegrationType, type MonitorState, type ProblemStatus } from '@shared/domain.ts'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { CodeBlock, CopyButton } from '@/components/ui/Code'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Field, Input, Select, Switch } from '@/components/ui/Field'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Segmented } from '@/components/ui/Segmented'
import { Chip } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import { HeartbeatIcon, MoreIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { IntegrationResource } from '@/lib/domain/schemas/integrations'
import { MonitorStateLabel, intervalLabel } from '../monitors/shared'

export interface HeartbeatRow {
  id: string
  name: string
  state: MonitorState
  enabled: boolean
  heartbeat_url: string | null
  last_heartbeat_at: string | null
  interval_seconds: number
}

export interface AsCodeSnippet {
  id: string
  label: string
  language: string
  source: string
}

interface Props {
  projectId: string
  integrations: IntegrationResource[]
  components: Array<{ id: string; name: string; slug: string }>
  heartbeats: HeartbeatRow[]
  snippets: AsCodeSnippet[]
  datadogTemplate: string
}

interface MappingRow {
  key: number
  labels: string
  component_id: string
  status: ProblemStatus | ''
}

interface Draft {
  id: string | null
  type: InboundIntegrationType
  name: string
  enabled: boolean
  default_component_id: string
  default_status: ProblemStatus
  auto_draft_incident: boolean
  mappings: MappingRow[]
}

let nextKey = 1

function emptyDraft(): Draft {
  return { id: null, type: 'alertmanager', name: 'Prometheus Alertmanager', enabled: true, default_component_id: '', default_status: 'partial_outage', auto_draft_incident: false, mappings: [] }
}

function draftFrom(integration: IntegrationResource): Draft {
  return {
    id: integration.id,
    type: integration.type,
    name: integration.name,
    enabled: integration.enabled,
    default_component_id: integration.default_component_id ?? '',
    default_status: integration.default_status,
    auto_draft_incident: integration.auto_draft_incident,
    mappings: integration.mappings.map((mapping) => ({
      key: nextKey++,
      labels: Object.entries(mapping.match)
        .map(([label, value]) => `${label}=${value}`)
        .join(', '),
      component_id: mapping.component_id,
      status: mapping.status ?? '',
    })),
  }
}

function parseLabels(text: string): Record<string, string> {
  const match: Record<string, string> = {}
  for (const part of text.split(',')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const label = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (label && value) match[label] = value
  }
  return match
}

export function IntegrationsManager({ projectId, integrations, components, heartbeats, snippets, datadogTemplate }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [codeTab, setCodeTab] = useState(snippets[0]?.id ?? '')
  const confirm = useConfirm()
  const { run, pending, fieldErrors } = useAction()
  const base = `/projects/${projectId}/integrations`
  const componentName = (id: string | null) => components.find((component) => component.id === id)?.name ?? 'Unknown component'
  const snippet = snippets.find((item) => item.id === codeTab) ?? snippets[0]

  const save = async () => {
    if (!draft) return
    const body = {
      type: draft.type,
      name: draft.name.trim(),
      enabled: draft.enabled,
      default_component_id: draft.default_component_id || null,
      default_status: draft.default_status,
      auto_draft_incident: draft.auto_draft_incident,
      mappings: draft.mappings
        .filter((mapping) => mapping.labels.trim() !== '' || mapping.component_id !== '')
        .map((mapping) => ({ match: parseLabels(mapping.labels), component_id: mapping.component_id, status: mapping.status || null })),
    }
    const saved = await run(
      () => (draft.id ? appRequest<IntegrationResource>(`${base}/${draft.id}`, { method: 'PATCH', body }) : appRequest<IntegrationResource>(base, { body })),
      { success: draft.id ? 'Integration saved' : 'Integration created', successDescription: draft.id ? undefined : draft.type === 'generic' ? 'Send alerts to its URL.' : `Copy its URL into ${INBOUND_INTEGRATION_LABELS[draft.type].replace(/ \(SNS\)$/, '')}.` },
    )
    if (saved) setDraft(null)
  }

  const toggle = (integration: IntegrationResource) =>
    run(() => appRequest(`${base}/${integration.id}`, { method: 'PATCH', body: { enabled: !integration.enabled } }), {
      success: integration.enabled ? 'Integration paused' : 'Integration resumed',
      successDescription: integration.enabled ? 'Upvane ignores its alerts until you resume it.' : undefined,
    })

  const remove = async (integration: IntegrationResource) => {
    const ok = await confirm({
      title: `Delete ${integration.name}?`,
      description: 'Its URL stops working and the alerts it is firing now resolve, so components it sets go back to their other status sources.',
      confirmLabel: 'Delete integration',
    })
    if (ok) await run(() => appRequest(`${base}/${integration.id}`, { method: 'DELETE' }), { success: 'Integration deleted' })
  }

  const update = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current))
  const updateMapping = (key: number, patch: Partial<MappingRow>) => setDraft((current) => (current ? { ...current, mappings: current.mappings.map((row) => (row.key === key ? { ...row, ...patch } : row)) } : current))
  const statusOptions = PROBLEM_STATUSES.map((status) => ({ value: status, label: COMPONENT_STATUS_LABELS[status] }))
  const componentOptions = components.map((component) => ({ value: component.id, label: component.name }))

  return (
    <>
      <Card>
        <CardHeader
          title="Alerts from your tools"
          description="Firing alerts set component status like a monitor would. Resolved alerts bring it back."
          actions={
            <Button variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={() => setDraft(emptyDraft())}>
              Add integration
            </Button>
          }
        />
        {integrations.length === 0 ? (
          <EmptyState
            title="No integrations yet"
            description="Connect Prometheus Alertmanager, Grafana, Datadog, CloudWatch or any tool that can send JSON. Your existing alerts then update the status page without anyone touching it."
            action={
              <Button variant="primary" onClick={() => setDraft(emptyDraft())}>
                Add integration
              </Button>
            }
          />
        ) : (
          <div className="int-list">
            {integrations.map((integration) => (
              <div className="int-item" key={integration.id}>
                <div className="int-item-head">
                  <div className="int-item-title">
                    <strong>{integration.name}</strong>
                    <span className="int-meta">
                      {integration.name !== INBOUND_INTEGRATION_LABELS[integration.type] ? <span>{INBOUND_INTEGRATION_LABELS[integration.type]}</span> : null}
                      <span>
                        {integration.received_count === 0 ? (
                          'No alerts received yet'
                        ) : (
                          <>
                            {integration.received_count.toLocaleString('en-US')} received, last <RelativeTime value={integration.last_received_at} />
                          </>
                        )}
                      </span>
                      <span>{integration.default_component_id ? `Default: ${componentName(integration.default_component_id)}` : 'No default component'}</span>
                    </span>
                  </div>
                  <div className="row" style={{ ['--gap' as string]: '8px' }}>
                    {!integration.enabled ? <Chip>Paused</Chip> : integration.active_signals > 0 ? <Chip tone="danger">{integration.active_signals} firing</Chip> : <Chip tone="success">Quiet</Chip>}
                    <Button size="sm" icon={<PencilIcon size={14} />} onClick={() => setDraft(draftFrom(integration))}>
                      Edit
                    </Button>
                    <Menu
                      label={`Actions for ${integration.name}`}
                      trigger={(props) => (
                        <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label={`Actions for ${integration.name}`} {...props}>
                          <MoreIcon size={16} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem icon={integration.enabled ? <PauseIcon size={14} /> : <PlayIcon size={14} />} onSelect={() => { close(); void toggle(integration) }}>
                            {integration.enabled ? 'Pause' : 'Resume'}
                          </MenuItem>
                          <MenuItem icon={<TrashIcon size={14} />} danger onSelect={() => { close(); void remove(integration) }}>
                            Delete
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  </div>
                </div>
                <div className="int-url">
                  <code title="Contains a secret token. Treat it like a password.">{integration.url}</code>
                  <CopyButton value={integration.url} label="Copy URL" />
                </div>
                {integration.last_error ? <Banner tone="warning">{integration.last_error}</Banner> : null}
                {integration.mappings.length > 0 ? (
                  <div className="int-meta">
                    {integration.mappings.slice(0, 4).map((mapping, index) => (
                      <span key={index}>
                        <span className="mono">
                          {Object.entries(mapping.match)
                            .map(([label, value]) => `${label}=${value}`)
                            .join(', ')}
                        </span>{' '}
                        sets {componentName(mapping.component_id)}
                        {mapping.status ? ` to ${COMPONENT_STATUS_LABELS[mapping.status].toLowerCase()}` : ''}
                      </span>
                    ))}
                    {integration.mappings.length > 4 ? <span>and {integration.mappings.length - 4} more</span> : null}
                  </div>
                ) : null}
                <details className="int-setup">
                  <summary className="link" style={{ cursor: 'pointer', width: 'fit-content' }}>
                    How to connect {INBOUND_INTEGRATION_LABELS[integration.type]}
                  </summary>
                  <SetupSteps type={integration.type} url={integration.url} datadogTemplate={datadogTemplate} />
                </details>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Heartbeats"
          description="Cron jobs and workers ping their URL when they finish. Silence past the grace period marks them down."
          actions={
            <ButtonLink href={`/p/${projectId}/monitors/new?type=heartbeat`} size="sm" icon={<HeartbeatIcon size={14} />}>
              Add heartbeat
            </ButtonLink>
          }
        />
        {heartbeats.length === 0 ? (
          <EmptyState title="No heartbeats yet" description="Add one for each scheduled job you want to hear about when it stops running: backups, billing runs, queue consumers." />
        ) : (
          <div className="int-list">
            {heartbeats.map((heartbeat) => (
              <div className="int-item" key={heartbeat.id}>
                <div className="int-item-head">
                  <div className="int-item-title">
                    <Link className="rowlink" href={`/p/${projectId}/monitors/${heartbeat.id}`} style={{ color: 'var(--text)', fontWeight: 600 }}>
                      {heartbeat.name}
                    </Link>
                    <span className="int-meta">
                      <span>Expected {intervalLabel(heartbeat.interval_seconds).toLowerCase()}</span>
                      <span>
                        Last ping <RelativeTime value={heartbeat.last_heartbeat_at} />
                      </span>
                    </span>
                  </div>
                  <MonitorStateLabel state={heartbeat.state} enabled={heartbeat.enabled} />
                </div>
                {heartbeat.heartbeat_url ? (
                  <div className="int-url">
                    <code>{heartbeat.heartbeat_url}</code>
                    <CopyButton value={heartbeat.heartbeat_url} label="Copy URL" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {snippet ? (
        <Card>
          <CardHeader
            title="Configuration as code"
            description={
              <>
                Manage this project from Terraform, scripts and CI with an <Link className="link" href="/settings/api-keys">API key</Link>. Every call is in the{' '}
                <Link className="link" href="/docs/api">
                  API reference
                </Link>
                .
              </>
            }
            actions={<Segmented<string> label="Tool" value={snippet.id} onChange={setCodeTab} options={snippets.map((item) => ({ value: item.id, label: item.label }))} />}
          />
          <div className="card-b">
            <CodeBlock code={snippet.source} language={snippet.language} />
          </div>
        </Card>
      ) : null}

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? `Edit ${draft.name}` : 'Add integration'}
        description="Alerts pick their component from the first matching mapping, then a component label with the component key, then the default."
        wide
        onSubmit={() => void save()}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>
              {draft?.id ? 'Save integration' : 'Create integration'}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="stack">
            <div className="mf-grid">
              <Field label="Source" error={fieldErrors.type}>
                {(props) => (
                  <Select
                    {...props}
                    value={draft.type}
                    disabled={draft.id !== null}
                    onChange={(event) => {
                      const type = event.target.value as InboundIntegrationType
                      const renamed = Object.values(INBOUND_INTEGRATION_LABELS).includes(draft.name) || draft.name === ''
                      update({ type, name: renamed ? INBOUND_INTEGRATION_LABELS[type] : draft.name })
                    }}
                    options={INBOUND_INTEGRATION_TYPES.map((type) => ({ value: type, label: INBOUND_INTEGRATION_LABELS[type] }))}
                  />
                )}
              </Field>
              <Field label="Name" error={fieldErrors.name}>
                {(props) => <Input {...props} value={draft.name} maxLength={80} onChange={(event) => update({ name: event.target.value })} />}
              </Field>
            </div>
            <div className="mf-grid">
              <Field label="Default component" optional hint="For alerts that match no mapping and have no component label." error={fieldErrors.default_component_id}>
                {(props) => <Select {...props} value={draft.default_component_id} onChange={(event) => update({ default_component_id: event.target.value })} options={[{ value: '', label: 'None: ignore unmatched alerts' }, ...componentOptions]} />}
              </Field>
              <Field label="Default status" hint="Used when neither a mapping nor the severity label sets one.">
                {(props) => <Select {...props} value={draft.default_status} onChange={(event) => update({ default_status: event.target.value as ProblemStatus })} options={statusOptions} />}
              </Field>
            </div>
            <div className="stack" style={{ ['--gap' as string]: '8px' }}>
              <div className="spread">
                <span className="field-label">Mappings</span>
                <span className="help">Labels as name=value, separated by commas. All must match.</span>
              </div>
              {draft.mappings.map((mapping, index) => (
                <div className="int-mapping" key={mapping.key}>
                  <Input aria-label="Labels to match" className="mono" value={mapping.labels} onChange={(event) => updateMapping(mapping.key, { labels: event.target.value })} placeholder="service=payments, env=prod" />
                  <Select aria-label="Component" value={mapping.component_id} onChange={(event) => updateMapping(mapping.key, { component_id: event.target.value })} options={[{ value: '', label: 'Choose a component' }, ...componentOptions]} />
                  <Select aria-label="Status" value={mapping.status} onChange={(event) => updateMapping(mapping.key, { status: event.target.value as ProblemStatus | '' })} options={[{ value: '', label: 'From severity' }, ...statusOptions]} />
                  <Button variant="quiet" size="sm" iconOnly icon={<TrashIcon size={14} />} aria-label="Remove mapping" onClick={() => update({ mappings: draft.mappings.filter((row) => row.key !== mapping.key) })} />
                  {fieldErrors[`mappings.${index}.match`] || fieldErrors[`mappings.${index}.component_id`] ? (
                    <p className="field-error" style={{ gridColumn: '1 / -1' }}>
                      {fieldErrors[`mappings.${index}.match`] ?? fieldErrors[`mappings.${index}.component_id`]}
                    </p>
                  ) : null}
                </div>
              ))}
              <div>
                <Button size="sm" icon={<PlusIcon size={14} />} onClick={() => update({ mappings: [...draft.mappings, { key: nextKey++, labels: '', component_id: '', status: '' }] })} disabled={components.length === 0}>
                  Add mapping
                </Button>
              </div>
            </div>
            <div className="mf-toggles">
              <Switch label="Open a draft incident when an alert sets a partial or major outage" checked={draft.auto_draft_incident} onChange={(checked) => update({ auto_draft_incident: checked })} />
              {draft.id ? <Switch label="Accept alerts" checked={draft.enabled} onChange={(checked) => update({ enabled: checked })} /> : null}
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  )
}

function SetupSteps({ type, url, datadogTemplate }: { type: InboundIntegrationType; url: string; datadogTemplate: string }) {
  switch (type) {
    case 'alertmanager':
      return (
        <div className="stack" style={{ ['--gap' as string]: '10px', marginTop: 10 }}>
          <ol>
            <li>Add a receiver to alertmanager.yml and route the alerts that matter to customers to it.</li>
            <li>
              Give alerts a <span className="mono">component</span> label with the component key, or add mappings. The <span className="mono">severity</span> label sets the status.
            </li>
          </ol>
          <CodeBlock language="yaml" code={`receivers:\n  - name: upvane\n    webhook_configs:\n      - url: ${url}\n        send_resolved: true`} />
        </div>
      )
    case 'grafana':
      return (
        <ol style={{ marginTop: 10 }}>
          <li>In Grafana, open Alerting, Contact points, and add a Webhook contact point with this URL and method POST.</li>
          <li>Use it in the notification policy of the alert rules that should show on the status page.</li>
          <li>
            Add a <span className="mono">component</span> label to those rules, or add mappings here.
          </li>
        </ol>
      )
    case 'datadog':
      return (
        <div className="stack" style={{ ['--gap' as string]: '10px', marginTop: 10 }}>
          <ol>
            <li>In Datadog, open Integrations, Webhooks, and add a webhook named upvane with this URL.</li>
            <li>Paste this payload. Datadog fills in the variables.</li>
            <li>
              Mention <span className="mono">@webhook-upvane</span> in the monitors that should update the status page. Tag them with <span className="mono">component:&lt;key&gt;</span>.
            </li>
          </ol>
          <CodeBlock language="json" code={datadogTemplate} />
        </div>
      )
    case 'cloudwatch':
      return (
        <ol style={{ marginTop: 10 }}>
          <li>Create an SNS topic and add an HTTPS subscription with this URL. Upvane confirms it on its own.</li>
          <li>Send the ALARM and OK actions of your CloudWatch alarms to the topic.</li>
          <li>Map alarms to components with mappings on alarm_name, or a default component.</li>
        </ol>
      )
    case 'generic':
      return (
        <div className="stack" style={{ ['--gap' as string]: '10px', marginTop: 10 }}>
          <p>POST one alert or an array of them. Send the same external_id with status resolved to clear it.</p>
          <CodeBlock
            language="shell"
            code={`curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "external_id": "disk-db-1",\n    "status": "degraded",\n    "component": "database",\n    "summary": "Disk 92% full on db-1"\n  }'`}
          />
        </div>
      )
  }
}
