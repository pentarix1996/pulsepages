import type { CheckResultStatus, DnsRecordType, HttpMethod, MonitorState, MonitorType } from '../domain.ts'

export interface HeaderPair {
  name: string
  value: string
}

export const ASSERTION_SOURCES = ['status_code', 'header', 'json', 'body', 'response_time'] as const
export type AssertionSource = (typeof ASSERTION_SOURCES)[number]

export const ASSERTION_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'greater_or_equal',
  'less_or_equal',
  'exists',
  'not_exists',
] as const
export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number]

export const ASSERTION_OPERATOR_LABELS: Record<AssertionOperator, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
  not_contains: 'does not contain',
  greater_than: 'is greater than',
  less_than: 'is less than',
  greater_or_equal: 'is at least',
  less_or_equal: 'is at most',
  exists: 'exists',
  not_exists: 'does not exist',
}

export interface Assertion {
  source: AssertionSource
  /** JSON path (`data.status`, `items[0].ok`) for json, header name for header. */
  path?: string | null
  operator: AssertionOperator
  value?: string | number | boolean | null
  /** What a failure means. Defaults to down. */
  on_fail?: 'down' | 'degraded'
}

export interface HttpMonitorConfig {
  url: string
  method?: HttpMethod
  headers?: HeaderPair[]
  body?: string | null
  /** Status codes or patterns: 200, "2xx", "200-299". Defaults to 200-399. */
  expected_status_codes?: Array<number | string>
  follow_redirects?: boolean
  assertions?: Assertion[]
  /** Responses slower than this mark the check as degraded. */
  latency_threshold_ms?: number | null
  /** Keyword monitors only. */
  keyword?: string
  keyword_mode?: 'contains' | 'not_contains'
  case_sensitive?: boolean
}

export interface TcpMonitorConfig {
  host: string
  port: number
  latency_threshold_ms?: number | null
}

export interface DnsMonitorConfig {
  hostname: string
  record_type?: DnsRecordType
  /** Values the answer must include. Empty means any answer is fine. */
  expected_values?: string[]
  /** any: at least one expected value is present; all: every expected value is present. */
  match?: 'any' | 'all'
}

export interface TlsMonitorConfig {
  hostname: string
  port?: number
  /** Days before expiry that turn the check degraded and send a warning. */
  warn_days?: number
}

export interface HeartbeatMonitorConfig {
  grace_seconds?: number
}

export type MonitorConfig = HttpMonitorConfig | TcpMonitorConfig | DnsMonitorConfig | TlsMonitorConfig | HeartbeatMonitorConfig

/** Shape returned by SQL claim_due_monitors() / claim_monitor() (monitor_run_payload). */
export interface MonitorRunPayload {
  id: string
  project_id: string
  name: string
  type: MonitorType
  config: Record<string, unknown>
  regions: string[]
  timeout_ms: number
  interval_seconds: number
  confirm_failures: number
  confirm_regions: number
  recovery_successes: number
  state: MonitorState
  tls_checked_at: string | null
  /** AES-GCM encrypted JSON array of HeaderPair (UPVANE_SECRETS_KEY), or null. */
  secret_headers: string | null
  region_states: Record<string, Pick<RegionState, 'consecutive_bad' | 'consecutive_up' | 'confirmed' | 'last_status'>>
}

/** What the runner sends to monitor-probe in one region. */
export interface ProbeRequest {
  monitor_id: string
  type: Exclude<MonitorType, 'heartbeat'>
  config: Record<string, unknown>
  timeout_ms: number
  secret_headers: string | null
}

export interface ProbeResult {
  region: string
  status: CheckResultStatus
  latency_ms: number | null
  http_status?: number | null
  error?: string | null
  checked_at: string
  tls_expires_at?: string | null
  details?: Record<string, unknown>
}

export type ConfirmedState = 'up' | 'degraded' | 'down'

export interface RegionState {
  region: string
  consecutive_bad: number
  consecutive_up: number
  confirmed: ConfirmedState
  last_status: CheckResultStatus | null
  last_latency_ms?: number | null
  last_error?: string | null
}

export interface EvaluationOutcome {
  status: 'up' | 'degraded' | 'down'
  error: string | null
  failures: string[]
}
