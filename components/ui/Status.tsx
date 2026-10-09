import { COMPONENT_STATUS_LABELS, COMPONENT_STATUS_SHORT_LABELS, isComponentStatus, type ComponentStatus } from '@shared/domain.ts'
import type { ReactNode } from 'react'

export type ChipTone = 'neutral' | 'danger' | 'warning' | 'success' | 'info' | 'accent'

export function Chip({ tone = 'neutral', children, className, title }: { tone?: ChipTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={['chip', tone !== 'neutral' ? `chip-${tone}` : '', className].filter(Boolean).join(' ')} title={title}>
      {children}
    </span>
  )
}

export function StatusDot({ status, pulse, large, className }: { status: ComponentStatus | 'none'; pulse?: boolean; large?: boolean; className?: string }) {
  const pulseClass = pulse ? (status === 'operational' ? 'dot-pulse-up' : status === 'major_outage' || status === 'partial_outage' ? 'dot-pulse-down' : '') : ''
  return <span className={['dot', large ? 'dot-lg' : '', `s-${status}`, pulseClass, className].filter(Boolean).join(' ')} aria-hidden="true" />
}

/** Colored dot + label. The label always carries the meaning (DESIGN.md §1.2). */
export function StatusPill({ status, short, pulse, children }: { status: string | null | undefined; short?: boolean; pulse?: boolean; children?: ReactNode }) {
  const known: ComponentStatus | 'none' = isComponentStatus(status) ? status : 'none'
  const label = known === 'none' ? 'No data' : short ? COMPONENT_STATUS_SHORT_LABELS[known] : COMPONENT_STATUS_LABELS[known]
  return (
    <span className={`pill s-${known}`}>
      <StatusDot status={known} pulse={pulse} />
      {children ?? label}
    </span>
  )
}

const IMPACT_TONES: Record<string, ChipTone> = { critical: 'danger', major: 'danger', minor: 'warning', none: 'neutral' }
const IMPACT_LABELS: Record<string, string> = { critical: 'Critical impact', major: 'Major impact', minor: 'Minor impact', none: 'No impact' }

export function ImpactChip({ impact }: { impact: string }) {
  return <Chip tone={IMPACT_TONES[impact] ?? 'neutral'}>{IMPACT_LABELS[impact] ?? impact}</Chip>
}
