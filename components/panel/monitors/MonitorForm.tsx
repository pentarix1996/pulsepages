'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, type ReactNode } from 'react'
import {
  COMPONENT_STATUS_LABELS,
  DNS_RECORD_TYPES,
  HTTP_METHODS,
  MONITOR_TYPE_HINTS,
  MONITOR_TYPE_LABELS,
  MONITOR_TYPES,
  PROBLEM_STATUSES,
  type MonitorType,
  type ProblemStatus,
} from '@shared/domain.ts'
import { MONITOR_DEFAULTS } from '@shared/monitoring/config.ts'
import { ASSERTION_OPERATOR_LABELS, ASSERTION_OPERATORS, type AssertionOperator, type AssertionSource } from '@shared/monitoring/types.ts'
import { PROBE_REGIONS, suggestedRegions } from '@shared/regions.ts'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/Code'
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/Field'
import { CodeIcon, GlobeIcon, HeartbeatIcon, LockIcon, PlusIcon, PulseIcon, SearchIcon, TrashIcon, ZapIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { MonitorResource } from '@/lib/domain/schemas/monitors'
import { intervalLabel } from './shared'

interface Props {
  projectId: string
  monitor: MonitorResource | null
  components: Array<{ id: string; slug: string; name: string }>
  minInterval: number
  maxRegions: number
  planName: string
  initialType?: MonitorType
}

interface HeaderRow {
  key: number
  name: string
  value: string
  secret: boolean
  /** A saved secret: an empty value keeps it. */
  saved: boolean
}

interface AssertionRow {
  key: number
  source: AssertionSource
  path: string
  operator: AssertionOperator
  value: string
  on_fail: 'down' | 'degraded'
}

const TYPE_ICONS: Record<MonitorType, ReactNode> = {
  http: <GlobeIcon size={16} />,
  keyword: <SearchIcon size={16} />,
  tcp: <ZapIcon size={16} />,
  dns: <CodeIcon size={16} />,
  tls: <LockIcon size={16} />,
  heartbeat: <HeartbeatIcon size={16} />,
}

const SOURCE_LABELS: Record<AssertionSource, string> = {
  status_code: 'Status code',
  header: 'Header',
  json: 'JSON field',
  body: 'Body text',
  response_time: 'Response time (ms)',
}

const CHECK_INTERVALS = [30, 60, 120, 180, 300, 600, 900, 1800, 3600]
const HEARTBEAT_INTERVALS = [60, 300, 600, 900, 1800, 3600, 7200, 21_600, 43_200, 86_400]
const TIMEOUTS = [3000, 5000, 10_000, 15_000, 20_000, 30_000]
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const VALUELESS = new Set<AssertionOperator>(['exists', 'not_exists'])

let nextKey = 1
const key = () => nextKey++

function str(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value)
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

export function MonitorForm({ projectId, monitor, components, minInterval, maxRegions, planName, initialType }: Props) {
  const router = useRouter()
  const { run, pending, fieldErrors } = useAction()
  const editing = monitor !== null
  const config = (monitor?.config ?? {}) as Record<string, unknown>

  const [type, setType] = useState<MonitorType>(monitor?.type ?? initialType ?? 'http')
  const [name, setName] = useState(monitor?.name ?? '')
  // http / keyword
  const [url, setUrl] = useState(str(config.url, 'https://'))
  const [method, setMethod] = useState(str(config.method, 'GET'))
  const [followRedirects, setFollowRedirects] = useState(config.follow_redirects !== false)
  const [expectedCodes, setExpectedCodes] = useState(Array.isArray(config.expected_status_codes) ? (config.expected_status_codes as unknown[]).join(', ') : '')
  const [body, setBody] = useState(str(config.body))
  const [latencyThreshold, setLatencyThreshold] = useState(str(config.latency_threshold_ms))
  const [keyword, setKeyword] = useState(str(config.keyword))
  const [keywordMode, setKeywordMode] = useState(str(config.keyword_mode, 'contains'))
  const [caseSensitive, setCaseSensitive] = useState(config.case_sensitive === true)
  const [headers, setHeaders] = useState<HeaderRow[]>(() => [
    ...((Array.isArray(config.headers) ? config.headers : []) as Array<{ name: string; value: string }>).map((header) => ({ key: key(), name: header.name, value: header.value, secret: false, saved: false })),
    ...(monitor?.secret_header_names ?? []).map((headerName) => ({ key: key(), name: headerName, value: '', secret: true, saved: true })),
  ])
  const [assertions, setAssertions] = useState<AssertionRow[]>(() =>
    ((Array.isArray(config.assertions) ? config.assertions : []) as Array<Record<string, unknown>>).map((assertion) => ({
      key: key(),
      source: (assertion.source as AssertionSource) ?? 'status_code',
      path: str(assertion.path),
      operator: (assertion.operator as AssertionOperator) ?? 'equals',
      value: str(assertion.value),
      on_fail: assertion.on_fail === 'degraded' ? 'degraded' : 'down',
    })),
  )
  // tcp / tls / dns
  const [host, setHost] = useState(str(config.host ?? config.hostname))
  const [port, setPort] = useState(str(config.port, type === 'tls' ? '443' : ''))
  const [recordType, setRecordType] = useState(str(config.record_type, 'A'))
  const [expectedValues, setExpectedValues] = useState(Array.isArray(config.expected_values) ? (config.expected_values as string[]).join('\n') : '')
  const [match, setMatch] = useState(str(config.match, 'any'))
  const [warnDays, setWarnDays] = useState(str(config.warn_days, String(MONITOR_DEFAULTS.tls_warn_days)))
  const [graceSeconds, setGraceSeconds] = useState(str(config.grace_seconds, String(MONITOR_DEFAULTS.heartbeat_grace_seconds)))
  // schedule
  const regionCap = maxRegions === -1 ? PROBE_REGIONS.length : maxRegions
  const [intervalSeconds, setIntervalSeconds] = useState<number>(monitor?.interval_seconds ?? Math.max(minInterval, type === 'heartbeat' ? 3600 : 60))
  const [timeoutMs, setTimeoutMs] = useState<number>(monitor?.timeout_ms ?? MONITOR_DEFAULTS.timeout_ms)
  const [regions, setRegions] = useState<string[]>(monitor?.regions ?? suggestedRegions(Math.min(regionCap, 4)))
  const [confirmFailures, setConfirmFailures] = useState(monitor?.confirm_failures ?? MONITOR_DEFAULTS.confirm_failures)
  const [confirmRegions, setConfirmRegions] = useState(monitor?.confirm_regions ?? Math.min(2, regionCap))
  const [recoverySuccesses, setRecoverySuccesses] = useState(monitor?.recovery_successes ?? MONITOR_DEFAULTS.recovery_successes)
  // effects
  const [componentIds, setComponentIds] = useState<string[]>(monitor?.components.map((component) => component.component_id) ?? [])
  const [failureStatus, setFailureStatus] = useState<ProblemStatus>(monitor?.failure_status ?? 'major_outage')
  const [degradedStatus, setDegradedStatus] = useState<ProblemStatus>(monitor?.degraded_status ?? 'degraded')
  const [autoDraft, setAutoDraft] = useState(monitor?.auto_draft_incident ?? true)
  const [enabled, setEnabled] = useState(monitor?.enabled ?? true)

  const isHttp = type === 'http' || type === 'keyword'
  const singleRegion = type === 'tls' || type === 'heartbeat'
  const effectiveRegions = singleRegion ? regions.slice(0, 1) : regions
  const effectiveConfirmRegions = Math.min(confirmRegions, Math.max(1, effectiveRegions.length))
  const intervals = (type === 'heartbeat' ? HEARTBEAT_INTERVALS : CHECK_INTERVALS.filter((value) => value >= minInterval)).concat(
    [intervalSeconds].filter((value) => !(type === 'heartbeat' ? HEARTBEAT_INTERVALS : CHECK_INTERVALS).includes(value)),
  )

  const error = (path: string) => fieldErrors[path] ?? null

  const chooseType = (next: MonitorType) => {
    setType(next)
    if (next === 'tls' && !port) setPort('443')
    if (next === 'heartbeat' && intervalSeconds < 300) setIntervalSeconds(3600)
    if (next !== 'heartbeat' && intervalSeconds < minInterval) setIntervalSeconds(minInterval)
    if (next === 'keyword' && method === 'HEAD') setMethod('GET')
  }

  const toggleRegion = (id: string) => {
    if (singleRegion) {
      setRegions([id, ...regions.filter((region) => region !== id)])
      return
    }
    setRegions((current) => (current.includes(id) ? current.filter((region) => region !== id) : current.length >= regionCap ? current : [...current, id]))
  }

  const buildConfig = (): Record<string, unknown> => {
    const threshold = latencyThreshold.trim() === '' ? null : Number(latencyThreshold)
    switch (type) {
      case 'http':
      case 'keyword': {
        const codes = expectedCodes
          .split(',')
          .map((code) => code.trim())
          .filter(Boolean)
          .map((code) => (/^\d{3}$/.test(code) ? Number(code) : code))
        const base: Record<string, unknown> = {
          url: url.trim(),
          method,
          headers: headers.filter((header) => !header.secret && header.name.trim() !== '').map((header) => ({ name: header.name.trim(), value: header.value })),
          body: BODY_METHODS.has(method) && body.trim() !== '' ? body : null,
          follow_redirects: followRedirects,
          assertions: assertions.map((assertion) => ({
            source: assertion.source,
            path: assertion.source === 'header' || assertion.source === 'json' ? assertion.path.trim() || null : null,
            operator: assertion.operator,
            value: VALUELESS.has(assertion.operator) ? null : assertion.value,
            on_fail: assertion.on_fail,
          })),
          latency_threshold_ms: threshold,
        }
        if (codes.length > 0) base.expected_status_codes = codes
        if (type === 'keyword') Object.assign(base, { keyword, keyword_mode: keywordMode, case_sensitive: caseSensitive })
        return base
      }
      case 'tcp':
        return { host: host.trim(), port: Number(port), latency_threshold_ms: threshold }
      case 'dns':
        return {
          hostname: host.trim(),
          record_type: recordType,
          expected_values: expectedValues
            .split(/[\n,]/)
            .map((value) => value.trim())
            .filter(Boolean),
          match,
        }
      case 'tls':
        return { hostname: host.trim(), port: Number(port || 443), warn_days: Number(warnDays) }
      case 'heartbeat':
        return { grace_seconds: Number(graceSeconds) }
    }
  }

  const submit = async () => {
    const secretRows = isHttp ? headers.filter((header) => header.secret && header.name.trim() !== '') : []
    const payload: Record<string, unknown> = {
      type,
      name: name.trim(),
      enabled,
      interval_seconds: intervalSeconds,
      regions: effectiveRegions,
      confirm_failures: confirmFailures,
      confirm_regions: effectiveConfirmRegions,
      recovery_successes: recoverySuccesses,
      failure_status: failureStatus,
      degraded_status: degradedStatus,
      auto_draft_incident: autoDraft,
      components: componentIds,
      config: buildConfig(),
    }
    if (type !== 'heartbeat') payload.timeout_ms = timeoutMs
    if (secretRows.length > 0 || (monitor?.secret_header_names.length ?? 0) > 0) {
      payload.secret_headers = secretRows.map((header) => ({ name: header.name.trim(), value: header.saved && header.value === '' ? null : header.value }))
    }
    if (editing && monitor.type === 'heartbeat') delete payload.type

    const saved = await run(
      () =>
        editing
          ? appRequest<MonitorResource>(`/projects/${projectId}/monitors/${monitor.id}`, { method: 'PATCH', body: payload })
          : appRequest<MonitorResource>(`/projects/${projectId}/monitors`, { body: payload }),
      { success: editing ? 'Monitor saved' : 'Monitor created', successDescription: editing ? undefined : type === 'heartbeat' ? 'Copy the ping URL into your job.' : 'The first check runs within a minute.', refresh: false },
    )
    if (saved) {
      router.push(`/p/${projectId}/monitors/${saved.id}`)
      router.refresh()
    }
  }

  const sentence = useMemo(() => {
    if (type === 'heartbeat') {
      return `Upvane expects a ping ${intervalLabel(intervalSeconds).toLowerCase()}. If none arrives within ${plural(Number(graceSeconds) || 0, 'second')} after that, the monitor goes down; the next ping brings it back up.`
    }
    const span = confirmFailures * intervalSeconds
    const regionPart = effectiveRegions.length <= 1 ? 'the monitor goes down' : `the monitor goes down when ${effectiveConfirmRegions} of ${effectiveRegions.length} regions agree`
    return `A region confirms a problem after ${plural(confirmFailures, 'failed check')} in a row (about ${span < 120 ? `${span} seconds` : `${Math.round(span / 60)} minutes`}), and ${regionPart}. It recovers after ${plural(recoverySuccesses, 'passing check')} in a row.`
  }, [type, intervalSeconds, graceSeconds, confirmFailures, recoverySuccesses, effectiveRegions.length, effectiveConfirmRegions])

  const statusOptions = PROBLEM_STATUSES.map((status) => ({ value: status, label: COMPONENT_STATUS_LABELS[status] }))
  const count = (max: number) => Array.from({ length: max }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))

  return (
    <form
      className="mf"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      noValidate
    >
      <Card>
        <CardHeader title="What to check" description={editing && monitor.type === 'heartbeat' ? 'Heartbeat monitors keep their type: their ping URL is already in your jobs.' : 'Pick how Upvane reaches your service.'} />
        <div className="card-b">
          <div className="mf-types" role="group" aria-label="Monitor type">
            {MONITOR_TYPES.map((option) => {
              const locked = editing && (monitor.type === 'heartbeat' ? option !== 'heartbeat' : option === 'heartbeat')
              return (
                <button key={option} type="button" className="mf-type" aria-pressed={type === option} disabled={locked} onClick={() => chooseType(option)}>
                  <strong>
                    {TYPE_ICONS[option]}
                    {MONITOR_TYPE_LABELS[option]}
                  </strong>
                  <span>{MONITOR_TYPE_HINTS[option]}</span>
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={type === 'heartbeat' ? 'Heartbeat' : 'Target'} />
        <div className="card-b stack">
          <Field label="Name" hint="Shown in alerts and incident drafts, such as Payments API health." error={error('name')}>
            {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Payments API health" autoFocus={!editing} />}
          </Field>

          {isHttp ? (
            <>
              <div className="mf-grid" style={{ gridTemplateColumns: 'minmax(0, 120px) minmax(0, 1fr)' }}>
                <Field label="Method" error={error('config.method')}>
                  {(props) => <Select {...props} value={method} onChange={(event) => setMethod(event.target.value)} options={HTTP_METHODS.filter((option) => type !== 'keyword' || option !== 'HEAD').map((option) => ({ value: option, label: option }))} />}
                </Field>
                <Field label="URL" hint="https only. Private and internal addresses are blocked." error={error('config.url')}>
                  {(props) => <Input {...props} className="mono" value={url} onChange={(event) => setUrl(event.target.value)} inputMode="url" placeholder="https://api.example.com/health" spellCheck={false} />}
                </Field>
              </div>
              {type === 'keyword' ? (
                <div className="mf-grid">
                  <Field label="Keyword" error={error('config.keyword')}>
                    {(props) => <Input {...props} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder='"status":"ok"' />}
                  </Field>
                  <Field label="The body must">
                    {(props) => (
                      <Select
                        {...props}
                        value={keywordMode}
                        onChange={(event) => setKeywordMode(event.target.value)}
                        options={[
                          { value: 'contains', label: 'Contain the keyword' },
                          { value: 'not_contains', label: 'Not contain the keyword' },
                        ]}
                      />
                    )}
                  </Field>
                  <div style={{ alignSelf: 'end', paddingBottom: 8 }}>
                    <Checkbox label="Match case" checked={caseSensitive} onChange={setCaseSensitive} />
                  </div>
                </div>
              ) : null}
              <div className="mf-grid">
                <Field label="Expected status codes" optional hint="Codes, classes or ranges: 200, 2xx, 200-299. Default 200-399." error={error('config.expected_status_codes')}>
                  {(props) => <Input {...props} className="mono" value={expectedCodes} onChange={(event) => setExpectedCodes(event.target.value)} placeholder="200-299" />}
                </Field>
                <Field label="Degraded above" optional hint="Slower responses mark the check as degraded." error={error('config.latency_threshold_ms')}>
                  {(props) => (
                    <div className="input-group">
                      <Input {...props} className="mono" type="number" min={1} max={60000} value={latencyThreshold} onChange={(event) => setLatencyThreshold(event.target.value)} placeholder="800" />
                      <span className="input-addon" style={{ borderLeft: 0, borderRight: '1px solid var(--line2)', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}>
                        ms
                      </span>
                    </div>
                  )}
                </Field>
              </div>
              <Switch label="Follow redirects (every hop is checked against private addresses)" checked={followRedirects} onChange={setFollowRedirects} />
              {BODY_METHODS.has(method) ? (
                <Field label="Request body" optional error={error('config.body')}>
                  {(props) => <Textarea {...props} className="mono" rows={4} value={body} onChange={(event) => setBody(event.target.value)} placeholder='{"ping": true}' />}
                </Field>
              ) : null}
              <HeadersEditor rows={headers} onChange={setHeaders} errors={fieldErrors} />
              <AssertionsEditor rows={assertions} onChange={setAssertions} errors={fieldErrors} />
            </>
          ) : null}

          {type === 'tcp' || type === 'tls' || type === 'dns' ? (
            <div className="mf-grid" style={{ gridTemplateColumns: type === 'dns' ? 'minmax(0, 1fr) minmax(0, 140px)' : 'minmax(0, 1fr) minmax(0, 140px)' }}>
              <Field label="Hostname" hint="Without scheme or path, such as db.example.com." error={error(type === 'tcp' ? 'config.host' : 'config.hostname')}>
                {(props) => <Input {...props} className="mono" value={host} onChange={(event) => setHost(event.target.value)} placeholder={type === 'tcp' ? 'db.example.com' : 'api.example.com'} spellCheck={false} />}
              </Field>
              {type === 'dns' ? (
                <Field label="Record type">
                  {(props) => <Select {...props} value={recordType} onChange={(event) => setRecordType(event.target.value)} options={DNS_RECORD_TYPES.map((option) => ({ value: option, label: option }))} />}
                </Field>
              ) : (
                <Field label="Port" error={error('config.port')}>
                  {(props) => <Input {...props} className="mono" type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} placeholder={type === 'tls' ? '443' : '5432'} />}
                </Field>
              )}
            </div>
          ) : null}
          {type === 'tcp' ? (
            <Field label="Degraded above" optional hint="Slower connections mark the check as degraded, in ms." error={error('config.latency_threshold_ms')}>
              {(props) => <Input {...props} className="mono" type="number" min={1} value={latencyThreshold} onChange={(event) => setLatencyThreshold(event.target.value)} placeholder="300" style={{ maxWidth: 200 }} />}
            </Field>
          ) : null}
          {type === 'dns' ? (
            <div className="mf-grid">
              <Field label="Expected values" optional hint="One per line. Empty means any answer is fine." error={error('config.expected_values')}>
                {(props) => <Textarea {...props} className="mono" rows={3} value={expectedValues} onChange={(event) => setExpectedValues(event.target.value)} placeholder="203.0.113.10" />}
              </Field>
              <Field label="Pass when the answer includes">
                {(props) => (
                  <Select
                    {...props}
                    value={match}
                    onChange={(event) => setMatch(event.target.value)}
                    options={[
                      { value: 'any', label: 'Any expected value' },
                      { value: 'all', label: 'Every expected value' },
                    ]}
                  />
                )}
              </Field>
            </div>
          ) : null}
          {type === 'tls' ? (
            <Field label="Warn before expiry" hint="Days before the certificate expires that turn the check degraded and send a warning." error={error('config.warn_days')}>
              {(props) => <Input {...props} type="number" min={1} max={365} value={warnDays} onChange={(event) => setWarnDays(event.target.value)} style={{ maxWidth: 160 }} />}
            </Field>
          ) : null}
          {type === 'heartbeat' ? (
            <>
              <Field label="Grace period" hint="Extra seconds after the expected time before the monitor goes down. Covers jobs that run long." error={error('config.grace_seconds')}>
                {(props) => <Input {...props} type="number" min={0} max={86400} value={graceSeconds} onChange={(event) => setGraceSeconds(event.target.value)} style={{ maxWidth: 160 }} />}
              </Field>
              {monitor?.heartbeat_url ? (
                <Field label="Ping URL" hint="Your job calls this after each run. Add /fail to report an error.">
                  {(props) => (
                    <div className="int-url">
                      <code id={props.id}>{monitor.heartbeat_url}</code>
                      <CopyButton value={monitor.heartbeat_url ?? ''} />
                    </div>
                  )}
                </Field>
              ) : (
                <p className="help">You get the ping URL after you create the monitor.</p>
              )}
            </>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Schedule and regions" description={maxRegions === -1 ? `The ${planName} plan checks every ${minInterval} seconds from any region.` : `The ${planName} plan checks every ${intervalLabel(minInterval).replace('Every ', '')} at most, from ${plural(maxRegions, 'region')}.`} />
        <div className="card-b stack">
          <div className="mf-grid">
            <Field label={type === 'heartbeat' ? 'Expected every' : 'Check'} error={error('interval_seconds')}>
              {(props) => (
                <Select
                  {...props}
                  value={String(intervalSeconds)}
                  onChange={(event) => setIntervalSeconds(Number(event.target.value))}
                  options={[...new Set(intervals)].sort((a, b) => a - b).map((value) => ({ value: String(value), label: intervalLabel(value) }))}
                />
              )}
            </Field>
            {type !== 'heartbeat' ? (
              <Field label="Timeout" error={error('timeout_ms')}>
                {(props) => <Select {...props} value={String(timeoutMs)} onChange={(event) => setTimeoutMs(Number(event.target.value))} options={TIMEOUTS.map((value) => ({ value: String(value), label: `${value / 1000} seconds` }))} />}
              </Field>
            ) : null}
          </div>

          {type !== 'heartbeat' ? (
            <div className="stack" style={{ ['--gap' as string]: '8px' }}>
              <div className="spread">
                <span className="field-label">{singleRegion ? 'Region' : 'Regions'}</span>
                <span className="help">{singleRegion ? 'TLS checks run from one region.' : `${effectiveRegions.length} of ${maxRegions === -1 ? PROBE_REGIONS.length : maxRegions} selected`}</span>
              </div>
              <div className="mf-regions">
                {(['Europe', 'North America', 'South America', 'Asia Pacific'] as const).map((continent) => (
                  <div className="mf-continent" key={continent}>
                    <h4>{continent}</h4>
                    <div className="mf-region-list">
                      {PROBE_REGIONS.filter((region) => region.continent === continent).map((region) => {
                        const selected = singleRegion ? effectiveRegions[0] === region.id : regions.includes(region.id)
                        return (
                          <button
                            key={region.id}
                            type="button"
                            className="mf-region"
                            aria-pressed={selected}
                            disabled={!selected && !singleRegion && regions.length >= regionCap}
                            onClick={() => toggleRegion(region.id)}
                            title={region.id}
                          >
                            {region.city}
                            <span className="mono">{region.short}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {error('regions') ? <p className="field-error">{error('regions')}</p> : null}
            </div>
          ) : null}

          {type !== 'heartbeat' ? (
            <div className="mf-grid">
              <Field label="Failed checks to confirm">
                {(props) => <Select {...props} value={String(confirmFailures)} onChange={(event) => setConfirmFailures(Number(event.target.value))} options={count(5)} />}
              </Field>
              <Field label="Regions that must agree">
                {(props) => <Select {...props} value={String(effectiveConfirmRegions)} onChange={(event) => setConfirmRegions(Number(event.target.value))} options={count(Math.max(1, effectiveRegions.length))} disabled={effectiveRegions.length <= 1} />}
              </Field>
              <Field label="Passing checks to recover">
                {(props) => <Select {...props} value={String(recoverySuccesses)} onChange={(event) => setRecoverySuccesses(Number(event.target.value))} options={count(5)} />}
              </Field>
            </div>
          ) : null}
          <p className="mf-sentence">{sentence}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="When it fails" description="What changes on your status page and in Upvane." />
        <div className="card-b stack">
          <Field label="Components it sets" optional hint="Their status follows this monitor unless an incident, maintenance or a pin says otherwise.">
            {(props) =>
              components.length === 0 ? (
                <p className="help" id={props.id}>
                  This project has no components yet. The monitor still alerts; link it to a component later to update the status page.
                </p>
              ) : (
                <div className="mf-comps" id={props.id}>
                  {components.map((component) => (
                    <Checkbox
                      key={component.id}
                      label={component.name}
                      checked={componentIds.includes(component.id)}
                      onChange={(checked) => setComponentIds((current) => (checked ? [...current, component.id] : current.filter((id) => id !== component.id)))}
                    />
                  ))}
                </div>
              )
            }
          </Field>
          <div className="mf-grid">
            <Field label="Status while down">
              {(props) => <Select {...props} value={failureStatus} onChange={(event) => setFailureStatus(event.target.value as ProblemStatus)} options={statusOptions} />}
            </Field>
            <Field label="Status while degraded">
              {(props) => <Select {...props} value={degradedStatus} onChange={(event) => setDegradedStatus(event.target.value as ProblemStatus)} options={statusOptions} />}
            </Field>
          </div>
          <div className="mf-toggles">
            <Switch label="Open a draft incident when it goes down" checked={autoDraft} onChange={setAutoDraft} />
            <Switch label={editing ? 'Checks are running' : 'Start checking right away'} checked={enabled} onChange={setEnabled} />
          </div>
        </div>
      </Card>

      {Object.keys(fieldErrors).length > 0 ? <Banner tone="danger">Some fields need attention. Fix the highlighted values and save again.</Banner> : null}

      <div className="mf-actions">
        <ButtonLink href={editing ? `/p/${projectId}/monitors/${monitor.id}` : `/p/${projectId}/monitors`}>Cancel</ButtonLink>
        <Button type="submit" variant="primary" loading={pending}>
          {editing ? 'Save monitor' : 'Create monitor'}
        </Button>
      </div>
    </form>
  )
}

function HeadersEditor({ rows, onChange, errors }: { rows: HeaderRow[]; onChange: (rows: HeaderRow[]) => void; errors: Record<string, string> }) {
  const update = (rowKey: number, patch: Partial<HeaderRow>) => onChange(rows.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)))
  // Server errors point at config.headers.N (plain) or secret_headers.N (secret), each counted separately.
  const indexes = new Map<number, number>()
  let plain = 0
  let secret = 0
  for (const row of rows) indexes.set(row.key, row.secret ? secret++ : plain++)
  return (
    <div className="stack" style={{ ['--gap' as string]: '8px' }}>
      <div className="spread">
        <span className="field-label">Request headers</span>
        <span className="help">Secret headers are encrypted and never shown again.</span>
      </div>
      {rows.length > 0 ? (
        <div className="mf-rows">
          {rows.map((row) => {
            const index = indexes.get(row.key) ?? 0
            const prefix = row.secret ? `secret_headers.${index}` : `config.headers.${index}`
            const rowError = errors[`${prefix}.name`] ?? errors[`${prefix}.value`]
            return (
              <div className="mf-row hdr" key={row.key}>
                <Input aria-label="Header name" className="mono" value={row.name} onChange={(event) => update(row.key, { name: event.target.value })} placeholder="Authorization" spellCheck={false} />
                <Input
                  aria-label={`Value of ${row.name || 'header'}`}
                  className="mono"
                  type={row.secret ? 'password' : 'text'}
                  value={row.value}
                  onChange={(event) => update(row.key, { value: event.target.value })}
                  placeholder={row.saved ? 'Saved. Leave empty to keep it' : row.secret ? 'Bearer …' : 'value'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Checkbox label="Secret" checked={row.secret} onChange={(secret) => update(row.key, { secret, saved: false, value: row.saved ? '' : row.value })} />
                <Button variant="quiet" size="sm" iconOnly icon={<TrashIcon size={14} />} aria-label={`Remove header ${row.name}`} onClick={() => onChange(rows.filter((item) => item.key !== row.key))} />
                {rowError ? <p className="field-error">{rowError}</p> : null}
              </div>
            )
          })}
        </div>
      ) : null}
      <div>
        <Button size="sm" variant="ghost" icon={<PlusIcon size={14} />} onClick={() => onChange([...rows, { key: key(), name: '', value: '', secret: false, saved: false }])}>
          Add header
        </Button>
      </div>
    </div>
  )
}

function AssertionsEditor({ rows, onChange, errors }: { rows: AssertionRow[]; onChange: (rows: AssertionRow[]) => void; errors: Record<string, string> }) {
  const update = (rowKey: number, patch: Partial<AssertionRow>) => onChange(rows.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)))
  return (
    <div className="stack" style={{ ['--gap' as string]: '8px' }}>
      <div className="spread">
        <span className="field-label">Assertions</span>
        <span className="help">Checked in order. The worst failure wins.</span>
      </div>
      {rows.length > 0 ? (
        <div className="mf-rows">
          {rows.map((row, index) => {
            const prefix = `config.assertions.${index}`
            const rowError = errors[`${prefix}.path`] ?? errors[`${prefix}.value`] ?? errors[`${prefix}.operator`] ?? errors[prefix]
            const hasPath = row.source === 'header' || row.source === 'json'
            return (
              <div className="mf-row asr" key={row.key}>
                <Select aria-label="What to check" value={row.source} onChange={(event) => update(row.key, { source: event.target.value as AssertionSource })} options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
                <Input
                  aria-label={row.source === 'header' ? 'Header name' : 'JSON path'}
                  className="mono"
                  value={hasPath ? row.path : ''}
                  disabled={!hasPath}
                  onChange={(event) => update(row.key, { path: event.target.value })}
                  placeholder={row.source === 'header' ? 'Content-Type' : row.source === 'json' ? 'data.status' : '—'}
                  spellCheck={false}
                />
                <Select aria-label="Comparison" value={row.operator} onChange={(event) => update(row.key, { operator: event.target.value as AssertionOperator })} options={ASSERTION_OPERATORS.map((operator) => ({ value: operator, label: ASSERTION_OPERATOR_LABELS[operator] }))} />
                <Input aria-label="Expected value" className="mono" value={VALUELESS.has(row.operator) ? '' : row.value} disabled={VALUELESS.has(row.operator)} onChange={(event) => update(row.key, { value: event.target.value })} placeholder={row.source === 'response_time' ? '800' : row.source === 'status_code' ? '200' : 'ok'} />
                <Select
                  aria-label="When it fails"
                  value={row.on_fail}
                  onChange={(event) => update(row.key, { on_fail: event.target.value as 'down' | 'degraded' })}
                  options={[
                    { value: 'down', label: 'Down' },
                    { value: 'degraded', label: 'Degraded' },
                  ]}
                />
                <Button variant="quiet" size="sm" iconOnly icon={<TrashIcon size={14} />} aria-label="Remove assertion" onClick={() => onChange(rows.filter((item) => item.key !== row.key))} />
                {rowError ? <p className="field-error">{rowError}</p> : null}
              </div>
            )
          })}
        </div>
      ) : null}
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon={<PulseIcon size={14} />}
          onClick={() => onChange([...rows, { key: key(), source: rows.length === 0 ? 'json' : 'status_code', path: rows.length === 0 ? 'status' : '', operator: 'equals', value: rows.length === 0 ? 'ok' : '', on_fail: 'down' }])}
        >
          Add assertion
        </Button>
      </div>
    </div>
  )
}
