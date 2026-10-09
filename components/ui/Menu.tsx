'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** Click-to-open popover menu that closes on outside click, Escape and item selection. */
export function Menu({ trigger, children, align = 'right', label, className }: { trigger: (props: { 'aria-expanded': boolean; 'aria-controls': string; onClick: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; label: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={['menu', className].filter(Boolean).join(' ')} ref={ref}>
      {trigger({ 'aria-expanded': open, 'aria-controls': id, onClick: () => setOpen((value) => !value) })}
      {open ? (
        <div className={['menu-panel', align === 'left' ? 'left' : ''].join(' ')} id={id} role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({ children, onSelect, danger, icon, disabled }: { children: ReactNode; onSelect: () => void; danger?: boolean; icon?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" className={['menu-item', danger ? 'danger' : ''].join(' ')} onClick={onSelect} disabled={disabled}>
      {icon}
      {children}
    </button>
  )
}
