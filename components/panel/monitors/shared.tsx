import { MONITOR_STATE_LABELS, type MonitorState } from '@shared/domain.ts'
import { regionInfo } from '@shared/regions.ts'
import type { CheckResultResource, MonitorResource, ProbeResultResource } from '@/lib/domain/schemas/monitors'

/** What the monitor checks, in one mono line: "GET https://…", "db.internal:5432", "A api.example.com". */
export function monitorTarget(monitor: Pick<MonitorResource, 'type' | 'config'>): string {
  const config = monitor.config as Record<string, unknown>
  switch (monitor.type) {
    case 'http':
    case 'keyword':
      return `${String(config.method ?? 'GET')} ${String(config.url ?? '')}`
    case 'tcp':
      return `TCP ${String(config.host ?? '')}:${String(config.port ?? '')}`
    case 'dns':
      return `DNS ${String(config.record_type ?? 'A')} ${String(config.hostname ?? '')}`
    case 'tls':
      return `TLS ${String(config.hostname ?? '')}:${String(config.port ?? 443)}`
    case 'heartbeat':
      return 'Heartbeat from your job'
  }
}

export function intervalLabel(seconds: number): string {
  if (seconds % 86_400 === 0) return seconds === 86_400 ? 'Every day' : `Every ${seconds / 86_400} days`
  if (seconds % 3600 === 0) return seconds === 3600 ? 'Every hour' : `Every ${seconds / 3600} hours`
  if (seconds % 60 === 0) return seconds === 60 ? 'Every minute' : `Every ${seconds / 60} minutes`
  return `Every ${seconds} seconds`
}

export function regionCode(id: string | null): string {
  if (!id) return '—'
  if (id === 'heartbeat') return 'PING'
  return regionInfo(id)?.short ?? id
}

export function regionName(id: string | null): string {
  if (!id) return 'Unknown'
  if (id === 'heartbeat') return 'Heartbeat ping'
  return regionInfo(id)?.city ?? id
}

const STATE_CLASS: Record<MonitorState, string> = { up: 'is-up', degraded: 'is-degraded', down: 'is-down', paused: 'is-paused', pending: 'is-pending' }

/** Dot + label for a monitor state. Down monitors pulse. */
export function MonitorStateLabel({ state, enabled = true, pausedReason }: { state: MonitorState; enabled?: boolean; pausedReason?: string | null }) {
  const effective: MonitorState = enabled ? state : 'paused'
  const label = !enabled && pausedReason === 'plan_limit' ? 'Paused by plan' : MONITOR_STATE_LABELS[effective]
  return (
    <span className={`mon-state ${STATE_CLASS[effective]}`}>
      <span className={['dot', effective === 'down' ? 'dot-pulse-down' : ''].join(' ')} aria-hidden="true" />
      {effective === 'pending' ? 'Waiting' : label}
    </span>
  )
}

type AnyResult = Pick<CheckResultResource, 'status' | 'http_status' | 'error'> | Pick<ProbeResultResource, 'status' | 'http_status' | 'error'>

/** Status code chip of a check result: the HTTP code when there is one, otherwise the outcome. */
export function ResultCode({ result }: { result: AnyResult }) {
  const tone = result.status === 'up' ? 'code-ok' : result.status === 'degraded' ? 'code-slow' : result.status === 'down' ? 'code-bad' : 'code-err'
  const label = result.http_status ? String(result.http_status) : result.status === 'up' ? 'OK' : result.status === 'degraded' ? 'SLOW' : result.status === 'down' ? 'FAIL' : 'ERR'
  return <span className={`code-chip ${tone}`}>{label}</span>
}

export const RESULT_LABELS: Record<string, string> = { up: 'Passed', degraded: 'Slow', down: 'Failed', error: 'Probe error' }

/** Short plain-language summary of a run: "3 regions passed, Tokyo failed". */
export function summarizeRun(results: Array<Pick<ProbeResultResource, 'region' | 'status'>>): string {
  if (results.length === 0) return 'No region answered.'
  const failed = results.filter((result) => result.status === 'down')
  const slow = results.filter((result) => result.status === 'degraded')
  const errors = results.filter((result) => result.status === 'error')
  const passed = results.length - failed.length - slow.length - errors.length
  const parts: string[] = []
  if (passed > 0) parts.push(`${passed} ${passed === 1 ? 'region' : 'regions'} passed`)
  if (slow.length > 0) parts.push(`${slow.map((result) => regionName(result.region)).join(', ')} slow`)
  if (failed.length > 0) parts.push(`${failed.map((result) => regionName(result.region)).join(', ')} failed`)
  if (errors.length > 0) parts.push(`${errors.length} probe ${errors.length === 1 ? 'error' : 'errors'}`)
  return parts.join(', ')
}
