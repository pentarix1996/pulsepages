import type { CSSProperties } from 'react'
import { initials } from '@/lib/format'

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />
}

export function Skeleton({ width = '100%', height = 14, style }: { width?: number | string; height?: number | string; style?: CSSProperties }) {
  return <span className="skel" aria-hidden="true" style={{ display: 'block', width, height, ...style }} />
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Avatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'md' | 'sm' }) {
  return (
    <span className={['avatar', size === 'sm' ? 'avatar-sm' : ''].join(' ')} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
