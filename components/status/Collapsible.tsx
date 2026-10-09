'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronRightIcon } from '@/components/ui/icons'

/** Component group: a header button with the group's worst status that shows or hides its rows. */
export function CollapsibleGroup({ name, status, statusLabel, defaultOpen, children }: { name: string; status: string; statusLabel: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  return (
    <div className="sp-group">
      <h3 className="sp-group-title">
        <button type="button" className={['sp-grp-h', open ? 'is-open' : ''].join(' ')} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
          <ChevronRightIcon size={16} strokeWidth={2.4} className="sp-chev" />
          <span className="sp-grp-name">{name}</span>
          <span className={`sp-st s-${status}`}>{statusLabel}</span>
        </button>
      </h3>
      <div id={bodyId} className={open ? 'sp-grp-body sp-grp-in' : 'sp-grp-body'} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

/** "Show 2 earlier updates" under the latest incident update. */
export function EarlierUpdates({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  if (count === 0) return null
  return (
    <>
      <div id={bodyId} className={['sp-older', open ? 'is-open' : ''].join(' ')} aria-hidden={!open} inert={!open}>
        <div>{children}</div>
      </div>
      <div className="sp-older-toggle">
        <button type="button" className="sp-btn-text" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
          {open ? (count === 1 ? 'Hide earlier update' : 'Hide earlier updates') : count === 1 ? 'Show 1 earlier update' : `Show ${count} earlier updates`}
        </button>
      </div>
    </>
  )
}
