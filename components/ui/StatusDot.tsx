import type { ComponentStatus } from '@/lib/types'
import { getStatusDotClass } from '@/lib/utils/helpers'

interface StatusDotProps {
  status: ComponentStatus
  pulse?: boolean
  size?: 'sm' | 'md'
}

export function StatusDot({ status, pulse = false, size = 'md' }: StatusDotProps) {
  const classes = [
    'status-dot',
    getStatusDotClass(status),
    pulse ? 'status-dot-pulse' : '',
  ].filter(Boolean).join(' ')

  return (
    <span
      className={classes}
      style={size === 'sm' ? { width: 6, height: 6 } : undefined}
    />
  )
}
