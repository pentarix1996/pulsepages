'use client'

import { useToast } from '@/hooks/useToast'

export function ToastContainer() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  const iconMap = {
    success: <polyline points="20 6 9 17 4 12" />,
    warning: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
    error: <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>,
    info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
  }

  const colorMap = {
    success: 'var(--status-emerald)',
    warning: 'var(--status-yellow)',
    error: 'var(--status-red)',
    info: 'var(--accent-violet)',
  }

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" onClick={() => removeToast(toast.id)}>
          <span className="toast-icon" style={{ color: colorMap[toast.variant] }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {iconMap[toast.variant]}
            </svg>
          </span>
          <div className="toast-content">
            <div className="toast-title">{toast.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
