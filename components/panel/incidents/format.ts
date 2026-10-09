// Labels and small pure helpers shared by the incident, maintenance and postmortem screens (client and server).
import {
  COMPONENT_STATUS_SHORT_LABELS,
  INCIDENT_COMPONENT_STATUSES,
  INCIDENT_STATUS_LABELS,
  statusLabel,
  type ComponentStatus,
  type IncidentSource,
  type IncidentStatus,
} from '@shared/domain.ts'
import type { IncidentUpdateResource } from '@/lib/domain/schemas/incidents'

export const SOURCE_LABELS: Record<IncidentSource, string> = {
  manual: 'Declared by hand',
  monitor: 'Opened by a monitor',
  signal: 'Opened by an external alert',
  api: 'Declared through the API',
  template: 'Declared from a template',
}

export const PUBLIC_STAGES = ['investigating', 'identified', 'monitoring', 'resolved'] as const
export type PublicStage = (typeof PUBLIC_STAGES)[number]

export const STAGE_ORDER: Record<IncidentStatus, number> = { draft: -1, investigating: 0, identified: 1, monitoring: 2, resolved: 3 }

/** Visual group of a stage: drafts are hollow, active stages red, monitoring amber, resolved green. */
export function stageTone(status: IncidentStatus): 'draft' | 'active' | 'monitoring' | 'resolved' {
  if (status === 'draft') return 'draft'
  if (status === 'resolved') return 'resolved'
  return status === 'monitoring' ? 'monitoring' : 'active'
}

export function stageLabel(status: IncidentStatus): string {
  return INCIDENT_STATUS_LABELS[status]
}

export const COMPONENT_STATUS_OPTIONS = INCIDENT_COMPONENT_STATUSES.map((status) => ({ value: status, label: COMPONENT_STATUS_SHORT_LABELS[status] }))

export function secondsBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null
  const seconds = (new Date(to).getTime() - new Date(from).getTime()) / 1000
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null
}

export interface ComponentChange {
  id: string
  name: string
  from: ComponentStatus | null
  to: ComponentStatus | null
}

/**
 * For each update carrying a component snapshot, what changed compared with the previous snapshot (updates are
 * newest first). The first snapshot lists every component it set.
 */
export function componentChangesByUpdate(updates: IncidentUpdateResource[], names: Map<string, string>): Map<string, ComponentChange[]> {
  const result = new Map<string, ComponentChange[]>()
  let previous: Record<string, ComponentStatus> | null = null
  for (const update of [...updates].reverse()) {
    if (update.kind === 'note' || update.kind === 'system') continue
    const snapshot = update.component_statuses ?? {}
    const changes: ComponentChange[] = []
    for (const [id, status] of Object.entries(snapshot)) {
      const before = previous?.[id] ?? null
      if (before !== status) changes.push({ id, name: names.get(id) ?? 'Removed component', from: before, to: status })
    }
    if (previous) {
      for (const [id, status] of Object.entries(previous)) {
        if (!(id in snapshot)) changes.push({ id, name: names.get(id) ?? 'Removed component', from: status, to: null })
      }
    }
    if (changes.length > 0) result.set(update.id, changes)
    previous = snapshot
  }
  return result
}

export function describeChange(change: ComponentChange): string {
  if (change.to === null) return `${change.name} removed`
  return `${change.name} ${change.from === null ? 'set to' : '→'} ${statusLabel(change.to, true).toLowerCase()}`
}

/** Short zone name for a time zone (CEST, GMT+2...), for "Times in …" hints. */
export function zoneName(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at).find((item) => item.type === 'timeZoneName')
    return part?.value ?? timeZone
  } catch {
    return timeZone
  }
}

/** Calendar day key in a time zone, to group timeline entries and decide when to print the date. */
export function dayKey(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
  } catch {
    return value.slice(0, 10)
  }
}

/** Prefilled when someone clicks "Resolve incident" with an empty composer. */
export const RESOLVE_MESSAGE = 'This incident has been resolved. Everything is working normally again.'

export function shortId(id: string): string {
  return id.slice(0, 8)
}
