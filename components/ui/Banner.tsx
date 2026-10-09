import type { ReactNode } from 'react'
import { AlertCircleIcon, CheckCircleIcon, InfoIcon, XCircleIcon } from './icons'

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'success' ? CheckCircleIcon : tone === 'danger' ? XCircleIcon : tone === 'warning' ? AlertCircleIcon : InfoIcon
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={16} />
      <div className="grow">{children}</div>
      {action}
    </div>
  )
}
