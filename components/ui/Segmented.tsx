'use client'

import type { ReactNode } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

/** Exclusive choice shown as a pill row (filters, views). */
export function Segmented<T extends string>({ options, value, onChange, label, className }: { options: SegmentedOption<T>[]; value: T; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <div className={['seg', className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}
