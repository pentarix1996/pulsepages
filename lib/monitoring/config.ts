import type { ComponentStatus, Plan } from '@/lib/types'
import { isPaidPlan, MONITOR_LIMITS, MONITOR_METHOD, MONITOR_MODE, MONITOR_RESPONSE_TYPE, type MonitorConfigInput, type MonitorJsonRule, type NormalizedMonitorConfig } from './types'

const DEFAULT_EXPECTED_STATUS_CODES = [200] as const

export const COMPONENT_STATUSES: readonly ComponentStatus[] = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance']

export function canUseAutomaticMonitoring(plan: Plan): boolean {
  return isPaidPlan(plan)
}

export function getMinimumMonitorIntervalSeconds(_plan: Plan): number {
  return MONITOR_LIMITS.MVP_MIN_INTERVAL_SECONDS
}

export function normalizeMonitorConfig(input: MonitorConfigInput, plan: Plan): NormalizedMonitorConfig {
  if (input.mode === MONITOR_MODE.MANUAL || !canUseAutomaticMonitoring(plan)) {
    return {
      component_id: input.component_id,
      mode: MONITOR_MODE.MANUAL,
      enabled: false,
      url: null,
      method: MONITOR_METHOD.GET,
      interval_seconds: MONITOR_LIMITS.DEFAULT_INTERVAL_SECONDS,
      timeout_ms: MONITOR_LIMITS.DEFAULT_TIMEOUT_MS,
      expected_status_codes: [...DEFAULT_EXPECTED_STATUS_CODES],
      response_type: MONITOR_RESPONSE_TYPE.NONE,
      json_rules: [],
      failure_status: 'major_outage',
      no_match_status: 'degraded',
    }
  }

  const interval = Math.max(
    getMinimumMonitorIntervalSeconds(plan),
    Number.isFinite(input.interval_seconds) ? Math.floor(input.interval_seconds ?? MONITOR_LIMITS.DEFAULT_INTERVAL_SECONDS) : MONITOR_LIMITS.DEFAULT_INTERVAL_SECONDS
  )

  const timeoutMs = Math.min(
    MONITOR_LIMITS.MAX_TIMEOUT_MS,
    Math.max(1000, Number.isFinite(input.timeout_ms) ? Math.floor(input.timeout_ms ?? MONITOR_LIMITS.DEFAULT_TIMEOUT_MS) : MONITOR_LIMITS.DEFAULT_TIMEOUT_MS)
  )

  return {
    component_id: input.component_id,
    mode: MONITOR_MODE.AUTOMATIC,
    enabled: Boolean(input.enabled ?? true),
    url: input.url?.trim() || null,
    method: input.method === MONITOR_METHOD.HEAD ? MONITOR_METHOD.HEAD : MONITOR_METHOD.GET,
    interval_seconds: interval,
    timeout_ms: timeoutMs,
    expected_status_codes: normalizeExpectedStatusCodes(input.expected_status_codes),
    response_type: input.response_type === MONITOR_RESPONSE_TYPE.JSON ? MONITOR_RESPONSE_TYPE.JSON : MONITOR_RESPONSE_TYPE.NONE,
    json_rules: normalizeJsonRules(input.json_rules),
    failure_status: normalizeComponentStatus(input.failure_status, 'major_outage'),
    no_match_status: normalizeComponentStatus(input.no_match_status, 'degraded'),
  }
}

function normalizeExpectedStatusCodes(codes: number[] | undefined): number[] {
  const normalized = (codes ?? [...DEFAULT_EXPECTED_STATUS_CODES])
    .map((code) => Math.floor(code))
    .filter((code) => code >= 100 && code <= 599)

  return [...new Set(normalized)].slice(0, 16)
}

function normalizeJsonRules(rules: MonitorJsonRule[] | undefined): MonitorJsonRule[] {
  return (rules ?? [])
    .filter((rule) => typeof rule.path === 'string' && rule.path.trim().length > 0)
    .map((rule) => ({
      path: rule.path.trim(),
      operator: rule.operator,
      value: rule.value,
      targetStatus: normalizeComponentStatus(rule.targetStatus, 'degraded'),
    }))
    .slice(0, 20)
}

function normalizeComponentStatus(status: ComponentStatus | undefined, fallback: ComponentStatus): ComponentStatus {
  return isComponentStatus(status) ? status : fallback
}

export function isComponentStatus(status: unknown): status is ComponentStatus {
  return typeof status === 'string' && COMPONENT_STATUSES.includes(status as ComponentStatus)
}
