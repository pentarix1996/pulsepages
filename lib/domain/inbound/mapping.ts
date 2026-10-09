// Alert → component signal. For each alert:
//   component: the first mapping whose `match` labels all equal the alert labels (case-insensitive) → its component;
//              else a `component` label (or the sender's explicit component) equal to a component key or id;
//              else the integration's default component; else the alert is unmatched.
//   status:    the mapping's status → the sender's explicit status → the severity label → the default status.
import type { ProblemStatus } from '@shared/domain.ts'
import { labelValue, type InboundAlert } from './types'

export interface MappingRule {
  match: Record<string, string>
  component_id: string
  status?: ProblemStatus | null
}

export interface MappingConfig {
  mappings: MappingRule[]
  default_component_id: string | null
  default_status: ProblemStatus
}

export interface ComponentRef {
  id: string
  slug: string
}

/** What ingest_signals() expects for each signal. */
export interface SignalInput {
  external_id: string
  component_id: string
  status: ProblemStatus
  active: boolean
  summary: string | null
  labels: Record<string, string>
}

const SEVERITY_STATUS: Record<string, ProblemStatus> = {
  critical: 'major_outage',
  crit: 'major_outage',
  fatal: 'major_outage',
  emergency: 'major_outage',
  emerg: 'major_outage',
  alert: 'major_outage',
  page: 'major_outage',
  disaster: 'major_outage',
  p1: 'major_outage',
  sev1: 'major_outage',
  'sev-1': 'major_outage',
  sev0: 'major_outage',
  'sev-0': 'major_outage',
  error: 'partial_outage',
  err: 'partial_outage',
  major: 'partial_outage',
  high: 'partial_outage',
  p2: 'partial_outage',
  sev2: 'partial_outage',
  'sev-2': 'partial_outage',
  warning: 'degraded',
  warn: 'degraded',
  minor: 'degraded',
  medium: 'degraded',
  moderate: 'degraded',
  average: 'degraded',
  low: 'degraded',
  info: 'degraded',
  p3: 'degraded',
  p4: 'degraded',
  p5: 'degraded',
  sev3: 'degraded',
  'sev-3': 'degraded',
  sev4: 'degraded',
  'sev-4': 'degraded',
}

/** critical → major_outage, error/high → partial_outage, warning → degraded; unknown words → null. */
export function severityToStatus(severity: string | null | undefined): ProblemStatus | null {
  if (!severity) return null
  return SEVERITY_STATUS[severity.trim().toLowerCase()] ?? null
}

export function mappingMatches(rule: MappingRule, labels: Record<string, string>): boolean {
  const entries = Object.entries(rule.match)
  if (entries.length === 0) return false
  return entries.every(([key, expected]) => {
    const actual = labelValue(labels, key)
    return actual !== undefined && actual.trim().toLowerCase() === expected.trim().toLowerCase()
  })
}

function findComponent(components: ComponentRef[], ref: string | null | undefined): ComponentRef | undefined {
  if (!ref) return undefined
  const value = ref.trim().toLowerCase()
  return components.find((component) => component.id === value || component.slug === value)
}

export interface MappingOutcome {
  signals: SignalInput[]
  /** Alerts that could not be tied to a component of this status page. */
  unmatched: InboundAlert[]
}

export function mapAlertsToSignals(alerts: InboundAlert[], config: MappingConfig, components: ComponentRef[]): MappingOutcome {
  const known = new Set(components.map((component) => component.id))
  const signals: SignalInput[] = []
  const unmatched: InboundAlert[] = []
  for (const alert of alerts) {
    const rule = config.mappings.find((candidate) => known.has(candidate.component_id) && mappingMatches(candidate, alert.labels))
    const componentId =
      rule?.component_id ??
      findComponent(components, alert.component ?? labelValue(alert.labels, 'component') ?? labelValue(alert.labels, 'upvane_component'))?.id ??
      (config.default_component_id && known.has(config.default_component_id) ? config.default_component_id : null)
    if (!componentId) {
      unmatched.push(alert)
      continue
    }
    signals.push({
      external_id: alert.external_id,
      component_id: componentId,
      status: rule?.status ?? alert.status ?? severityToStatus(alert.severity) ?? config.default_status,
      active: alert.active,
      summary: alert.summary,
      labels: alert.labels,
    })
  }
  return { signals, unmatched }
}
