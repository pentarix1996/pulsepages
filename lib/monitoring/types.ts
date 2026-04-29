import type { ComponentStatus, Plan } from '@/lib/types'

export const MONITOR_MODE = {
  MANUAL: 'manual',
  AUTOMATIC: 'automatic',
} as const

export type MonitorMode = (typeof MONITOR_MODE)[keyof typeof MONITOR_MODE]

export const MONITOR_METHOD = {
  GET: 'GET',
  HEAD: 'HEAD',
} as const

export type MonitorMethod = (typeof MONITOR_METHOD)[keyof typeof MONITOR_METHOD]

export const MONITOR_RESPONSE_TYPE = {
  NONE: 'none',
  JSON: 'json',
} as const

export type MonitorResponseType = (typeof MONITOR_RESPONSE_TYPE)[keyof typeof MONITOR_RESPONSE_TYPE]

export const MONITOR_OPERATOR = {
  EXISTS: 'exists',
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  CONTAINS: 'contains',
  GREATER_THAN: 'greater_than',
  LESS_THAN: 'less_than',
} as const

export type MonitorOperator = (typeof MONITOR_OPERATOR)[keyof typeof MONITOR_OPERATOR]

export const MONITOR_STATUS = {
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const

export type MonitorCheckStatus = (typeof MONITOR_STATUS)[keyof typeof MONITOR_STATUS]

export const MONITOR_LIMITS = {
  MVP_MIN_INTERVAL_SECONDS: 60,
  FUTURE_BUSINESS_MIN_INTERVAL_SECONDS: 15,
  DEFAULT_INTERVAL_SECONDS: 60,
  DEFAULT_TIMEOUT_MS: 5000,
  MAX_TIMEOUT_MS: 10000,
  MAX_RESPONSE_BYTES: 64 * 1024,
  MAX_BATCH_SIZE: 50,
  RECENT_RESULTS_LIMIT: 20,
  MAX_RECENT_RESULTS: 300,
} as const

export interface MonitorJsonRule {
  path: string
  operator: MonitorOperator
  value?: unknown
  targetStatus: ComponentStatus
}

export interface MonitorConfigInput {
  component_id: string
  mode: MonitorMode
  enabled?: boolean
  url?: string | null
  method?: MonitorMethod
  interval_seconds?: number
  timeout_ms?: number
  expected_status_codes?: number[]
  response_type?: MonitorResponseType
  json_rules?: MonitorJsonRule[]
  failure_status?: ComponentStatus
  no_match_status?: ComponentStatus
}

export interface NormalizedMonitorConfig extends Required<Omit<MonitorConfigInput, 'url'>> {
  url: string | null
}

export interface MonitorCheckResult {
  id: string
  component_id: string
  config_id: string
  status: MonitorCheckStatus
  resulting_status: ComponentStatus | null
  http_status: number | null
  response_time_ms: number | null
  error_message: string | null
  checked_at: string
}

export interface MonitorConfigRow extends NormalizedMonitorConfig {
  id: string
  project_id: string
  last_checked_at: string | null
  next_check_at: string | null
  created_at: string
  updated_at: string
}

export function isPaidPlan(plan: Plan): boolean {
  return plan === 'pro' || plan === 'business'
}
