// Read-only panels of the monitor page: region tiles, configuration, alert routing and heartbeat setup.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ALERT_CHANNEL_LABELS, ALERT_EVENT_LABELS, COMPONENT_STATUS_LABELS, type AlertEventType, type ComponentStatus } from '@shared/domain.ts'
import { ASSERTION_OPERATOR_LABELS, type AssertionOperator } from '@shared/monitoring/types.ts'
import { Card, CardHeader } from '@/components/ui/Card'
import { CodeBlock, CopyButton } from '@/components/ui/Code'
import { Chip, StatusPill } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import type { AlertRoutingSummary, LatencyBucket } from '@/lib/domain/monitors'
import type { MonitorResource } from '@/lib/domain/schemas/monitors'
import type { MonitorRegionStateRow } from '@/lib/domain/types'
import { formatDate, formatDateTime, formatDuration, formatMs } from '@/lib/format'
import { intervalLabel, regionCode, regionName } from './shared'

// ------------------------------------------------------------------ region tiles
export function RegionTiles({ monitor, regionStates, series }: { monitor: MonitorResource; regionStates: MonitorRegionStateRow[]; series: LatencyBucket[] }) {
  const threshold = Number((monitor.config as Record<string, unknown>).latency_threshold_ms) || null
  const states = new Map(regionStates.map((row) => [row.region, row]))
  return (
    <section className="mon-tiles" aria-label="Regions">
      {monitor.regions.map((region) => {
        const state = states.get(region)
        const buckets = series.filter((bucket) => bucket.region === region).sort((a, b) => a.bucket - b.bucket)
        const checks = buckets.reduce((sum, bucket) => sum + bucket.checks, 0)
        const failing = buckets.reduce((sum, bucket) => sum + bucket.failing, 0)
        const passing = checks > 0 ? ((checks - failing) / checks) * 100 : null
        const confirmed = state?.confirmed ?? 'up'
        const last = state?.last_status ?? null
        const ms = state?.last_latency_ms ?? null
        const label = !state?.last_checked_at ? 'No checks yet' : confirmed === 'down' ? 'Failing' : confirmed === 'degraded' ? 'Slow' : last === 'down' ? 'Failed once, confirming' : last === 'error' ? 'Probe error' : 'Passing'
        return (
          <div key={region} className={['mon-tile', confirmed === 'down' ? 't-down' : confirmed === 'degraded' ? 't-degraded' : ''].join(' ')}>
            <div className="mon-tile-top">
              <strong>{regionName(region)}</strong>
              <span className="mono faint" style={{ fontSize: 12 }}>
                {regionCode(region)}
              </span>
            </div>
            <div className="mon-tile-top">
              <span className={confirmed === 'down' ? 's-major' : confirmed === 'degraded' ? 's-degraded' : last === 'down' || last === 'error' ? 'muted' : 's-operational'} style={{ fontSize: 13, fontWeight: 600 }}>
                {label}
              </span>
              <span className={['mon-tile-ms', confirmed === 'down' ? 'bad' : threshold && ms && ms > threshold ? 'slow' : ''].join(' ')}>{formatMs(ms)}</span>
            </div>
            <div className="mon-ticks" aria-hidden="true">
              {(buckets.length > 0 ? buckets : Array.from({ length: 48 }, () => null)).map((bucket, index) => (
                <span key={index} className={!bucket || bucket.checks === 0 ? 'none' : bucket.failing > 0 ? 'major' : bucket.degraded > 0 ? 'deg' : ''} />
              ))}
            </div>
            <span className="mon-tile-foot">{passing === null ? 'No checks in the last 24 hours' : `${passing >= 99.95 && passing < 100 ? passing.toFixed(2) : passing.toFixed(1).replace(/\.0$/, '')}% passing, last 24 hours`}</span>
            {confirmed !== 'up' && state?.last_error ? <span className="mon-tile-err">{state.last_error}</span> : null}
          </div>
        )
      })}
    </section>
  )
}

// ------------------------------------------------------------------ configuration
const SOURCE_TEXT: Record<string, string> = { status_code: 'Status code', header: 'Header', json: 'JSON field', body: 'Body', response_time: 'Response time' }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mon-row2">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  )
}

export function MonitorConfigCard({ monitor, componentStatuses, projectId }: { monitor: MonitorResource; componentStatuses: Record<string, ComponentStatus>; projectId: string }) {
  const config = monitor.config as Record<string, unknown>
  const headers = (Array.isArray(config.headers) ? config.headers : []) as Array<{ name: string; value: string }>
  const assertions = (Array.isArray(config.assertions) ? config.assertions : []) as Array<{ source: string; path?: string | null; operator: AssertionOperator; value?: unknown; on_fail?: string }>
  const codes = Array.isArray(config.expected_status_codes) && config.expected_status_codes.length > 0 ? (config.expected_status_codes as unknown[]).join(', ') : '200-399'
  const failLabel = (onFail?: string) => (onFail === 'degraded' ? COMPONENT_STATUS_LABELS[monitor.degraded_status] : COMPONENT_STATUS_LABELS[monitor.failure_status])
  const isHttp = monitor.type === 'http' || monitor.type === 'keyword'
  // Server Component, rendered once per request: reading the clock here is safe.
  // eslint-disable-next-line react-hooks/purity
  const tlsDaysLeft = monitor.tls_expires_at ? Math.max(0, Math.round((Date.parse(monitor.tls_expires_at) - Date.now()) / 86_400_000)) : null

  return (
    <Card aria-label="Configuration" style={{ flex: '3 1 520px', minWidth: 0 }}>
      <CardHeader title="Configuration" description={`Updated ${formatDateTime(monitor.updated_at)}`} />
      {isHttp ? (
        <div className="mon-sec">
          <h3>Request</h3>
          <Row label="Method and URL">
            <span className="mono">
              {String(config.method ?? 'GET')} {String(config.url ?? '')}
            </span>
          </Row>
          {headers.length + monitor.secret_header_names.length > 0 ? (
            <Row label="Headers">
              <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                {headers.map((header) => (
                  <span key={header.name} className="mono">
                    {header.name}: {header.value}
                  </span>
                ))}
                {monitor.secret_header_names.map((name) => (
                  <span key={name} className="mono">
                    {name}: <span className="faint">encrypted</span>
                  </span>
                ))}
              </span>
            </Row>
          ) : null}
          {config.body ? (
            <Row label="Body">
              <span className="mono">{String(config.body).slice(0, 160)}</span>
            </Row>
          ) : null}
          <Row label="Redirects">{config.follow_redirects === false ? 'Not followed' : 'Followed, up to 5 hops'}</Row>
          <Row label="Timeout">{formatDuration(monitor.timeout_ms / 1000)}</Row>
        </div>
      ) : null}
      {monitor.type === 'tcp' || monitor.type === 'dns' || monitor.type === 'tls' ? (
        <div className="mon-sec">
          <h3>Target</h3>
          <Row label="Host">
            <span className="mono">{String(config.host ?? config.hostname ?? '')}</span>
          </Row>
          {monitor.type === 'dns' ? (
            <>
              <Row label="Record">
                <span className="mono">{String(config.record_type ?? 'A')}</span>
              </Row>
              <Row label="Expected">
                {Array.isArray(config.expected_values) && config.expected_values.length > 0 ? (
                  <span className="mono">
                    {(config.expected_values as string[]).join(', ')} ({config.match === 'all' ? 'all of them' : 'any of them'})
                  </span>
                ) : (
                  'Any answer'
                )}
              </Row>
            </>
          ) : (
            <Row label="Port">
              <span className="mono">{String(config.port ?? (monitor.type === 'tls' ? 443 : ''))}</span>
            </Row>
          )}
          {monitor.type !== 'dns' ? <Row label="Timeout">{formatDuration(monitor.timeout_ms / 1000)}</Row> : null}
        </div>
      ) : null}
      {isHttp || monitor.type === 'tcp' ? (
        <div className="mon-sec">
          <h3>Assertions</h3>
          {isHttp ? <Row label={`Fails as ${failLabel().toLowerCase()}`}>Status code is {codes}</Row> : null}
          {monitor.type === 'keyword' ? (
            <Row label={`Fails as ${failLabel().toLowerCase()}`}>
              Body {config.keyword_mode === 'not_contains' ? 'does not contain' : 'contains'} <span className="mono">{String(config.keyword ?? '')}</span>
              {config.case_sensitive ? ' (case sensitive)' : ''}
            </Row>
          ) : null}
          {assertions.map((assertion, index) => (
            <Row key={index} label={`Fails as ${failLabel(assertion.on_fail).toLowerCase()}`}>
              {SOURCE_TEXT[assertion.source] ?? assertion.source} {assertion.path ? <span className="mono">{assertion.path}</span> : null} {ASSERTION_OPERATOR_LABELS[assertion.operator] ?? assertion.operator}{' '}
              {assertion.value !== null && assertion.value !== undefined ? <span className="mono">{String(assertion.value)}</span> : null}
            </Row>
          ))}
          {config.latency_threshold_ms ? <Row label={`Slow as ${COMPONENT_STATUS_LABELS[monitor.degraded_status].toLowerCase()}`}>Response takes longer than {formatMs(Number(config.latency_threshold_ms))}</Row> : null}
        </div>
      ) : null}
      {monitor.type === 'tls' ? (
        <div className="mon-sec">
          <h3>Certificate</h3>
          <Row label="Expires">{monitor.tls_expires_at ? `${formatDate(monitor.tls_expires_at)} (${tlsDaysLeft} days)` : 'Not read yet'}</Row>
          <Row label="Warns">{String(config.warn_days ?? 14)} days before expiry</Row>
        </div>
      ) : null}
      <div className="mon-sec">
        <h3>When it fails</h3>
        <Row label="Confirmation">
          {monitor.type === 'heartbeat'
            ? `Down when no ping arrives ${intervalLabel(monitor.interval_seconds).toLowerCase()} plus ${formatDuration(Number(config.grace_seconds ?? 300))} of grace.`
            : `${monitor.confirm_failures} failed checks in a row in ${monitor.confirm_regions} of ${monitor.regions.length} ${monitor.regions.length === 1 ? 'region' : 'regions'}; recovers after ${monitor.recovery_successes} passing checks.`}
        </Row>
        <Row label="Components">
          {monitor.components.length === 0 ? (
            <span className="faint">None. This monitor only alerts.</span>
          ) : (
            <span className="stack" style={{ ['--gap' as string]: '6px' }}>
              {monitor.components.map((component) => (
                <span key={component.component_id} className="row" style={{ ['--gap' as string]: '10px' }}>
                  <Link className="link" href={`/p/${projectId}/components`}>
                    {component.name}
                  </Link>
                  <StatusPill status={componentStatuses[component.component_id]} short />
                </span>
              ))}
            </span>
          )}
        </Row>
        <Row label="Sets them to">
          {COMPONENT_STATUS_LABELS[monitor.failure_status]} while down, {COMPONENT_STATUS_LABELS[monitor.degraded_status].toLowerCase()} while degraded
        </Row>
        <Row label="Draft incident">{monitor.auto_draft_incident ? 'Opens one when it goes down' : 'Off'}</Row>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ alert routing
const SEVERITY_LABEL: Record<string, string> = { operational: 'Recovery', degraded: 'Degraded', partial_outage: 'Partial outage', major_outage: 'Major outage' }

export function AlertRoutingCard({ routing, projectId }: { routing: AlertRoutingSummary; projectId: string }) {
  const cooldowns = [...new Set(routing.rows.flatMap((row) => row.rules.map((rule) => rule.cooldown_minutes)))]
  return (
    <Card aria-label="Alert routing" style={{ flex: '2 1 320px', minWidth: 0 }}>
      <CardHeader
        title="Alert routing"
        actions={
          <Link className="link" href={`/p/${projectId}/alerts`} style={{ fontSize: 13 }}>
            Edit rules
          </Link>
        }
      />
      {!routing.alertsEnabled ? <p className="mon-empty">Alerts are off for this project. Turn them on in Alerts.</p> : null}
      {routing.rows.map((row) => (
        <div key={row.event} className="mon-route">
          <span className="mon-route-head">
            {row.severity === 'operational' ? <StatusPill status="operational">{ALERT_EVENT_LABELS[row.event as AlertEventType]}</StatusPill> : <StatusPill status={row.severity}>{ALERT_EVENT_LABELS[row.event as AlertEventType]}</StatusPill>}
            <span className="faint" style={{ fontSize: 12, fontWeight: 500 }}>
              {SEVERITY_LABEL[row.severity]}
            </span>
          </span>
          {row.channels.length === 0 ? (
            <span className="faint" style={{ fontSize: 13 }}>
              No rule sends this anywhere.
            </span>
          ) : (
            <span className="mon-route-channels">
              {row.channels.map((channel) => (
                <Chip key={channel.id} tone={channel.enabled ? 'neutral' : 'warning'} title={channel.enabled ? undefined : 'Channel disabled'}>
                  {channel.name}
                  <span className="faint">{ALERT_CHANNEL_LABELS[channel.type]}</span>
                </Chip>
              ))}
            </span>
          )}
        </div>
      ))}
      <div className="card-b" style={{ paddingTop: 4 }}>
        <div className="kv">
          <span>Cooldown</span>
          <span>{cooldowns.length === 0 ? '—' : cooldowns.map((minutes) => `${minutes} min`).join(', ')}</span>
        </div>
        <div className="kv">
          <span>Maintenance</span>
          <span>{routing.muteDuringMaintenance ? 'Muted during windows' : 'Alerts during windows'}</span>
        </div>
        <div className="kv">
          <span>Last alert</span>
          <span>
            {routing.lastEvent ? (
              <>
                {ALERT_EVENT_LABELS[routing.lastEvent.type as AlertEventType] ?? routing.lastEvent.type}, <RelativeTime value={routing.lastEvent.created_at} />
                {routing.lastEvent.suppression_reason ? <span className="faint"> (suppressed: {routing.lastEvent.suppression_reason.replace(/_/g, ' ')})</span> : null}
              </>
            ) : (
              'None yet'
            )}
          </span>
        </div>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ heartbeat
export function HeartbeatCard({ monitor }: { monitor: MonitorResource }) {
  const config = monitor.config as Record<string, unknown>
  const url = monitor.heartbeat_url
  const grace = Number(config.grace_seconds ?? 300)
  const lastPing = monitor.last_heartbeat_at
  const dueAt = lastPing ? Date.parse(lastPing) + monitor.interval_seconds * 1000 : null
  return (
    <Card aria-label="Heartbeat">
      <CardHeader title="Heartbeat" description="Your job calls the ping URL when it finishes. Silence past the grace period means it stopped." />
      <div className="mon-heartbeat">
        <div className="mon-heartbeat-stats">
          <span>
            <strong>{lastPing ? <RelativeTime value={lastPing} /> : 'Never'}</strong>
            <span className="faint">Last ping</span>
          </span>
          <span>
            <strong>{intervalLabel(monitor.interval_seconds).replace('Every ', '')}</strong>
            <span className="faint">Expected every</span>
          </span>
          <span>
            <strong>{formatDuration(grace)}</strong>
            <span className="faint">Grace period</span>
          </span>
          {dueAt ? (
            <span>
              <strong>{formatDateTime(new Date(dueAt + grace * 1000))}</strong>
              <span className="faint">Down if silent until</span>
            </span>
          ) : null}
        </div>
        {url ? (
          <>
            <div className="int-url">
              <code>{url}</code>
              <CopyButton value={url} />
            </div>
            <CodeBlock
              language="shell"
              code={`# After the job succeeds\ncurl -fsS -m 10 --retry 3 ${url}\n\n# Report a failure with a message\ncurl -fsS -m 10 --data "exit code $?" ${url}/fail\n\n# Or wrap the command with the Upvane CLI\nnpx @upvane/cli heartbeat ${url.split('/').pop()} -- ./backup.sh`}
            />
          </>
        ) : (
          <p className="help">Only admins can see the ping URL.</p>
        )}
      </div>
    </Card>
  )
}
