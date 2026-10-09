import type { ReactNode } from 'react'
import { CheckIcon } from '@/components/ui/icons'
import type { Tick } from './ticks'

/** Checked bullet list used by the feature sections. */
export function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="lp-points" role="list">
      {items.map((item, index) => (
        <li key={index}>
          <CheckIcon size={18} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** Decorative uptime ticks (dark theme). */
export function Ticks({ ticks, className }: { ticks: Tick[]; className?: string }) {
  return (
    <span className={['lp-ticks', className].filter(Boolean).join(' ')} aria-hidden="true">
      {ticks.map((tick, index) => (
        <span key={index} className={tick === 'up' ? 'lp-tk' : `lp-tk ${tick}`} />
      ))}
    </span>
  )
}

/** Section heading + lede pair. */
export function SectionIntro({ title, lede, children, id }: { title: string; lede: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="lp-intro">
      <h2 className="lp-h2" id={id}>
        {title}
      </h2>
      <p className="lp-lede">{lede}</p>
      {children}
    </div>
  )
}
