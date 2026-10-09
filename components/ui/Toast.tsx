'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircleIcon, CheckCircleIcon, InfoIcon, XIcon } from './icons'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), [])

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId.current++
      setItems((current) => [...current.slice(-3), { id, tone, title, description }])
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 5000)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push('success', title, description),
      error: (title, description) => push('error', title, description),
      info: (title, description) => push('info', title, description),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((item) => {
          const Icon = item.tone === 'success' ? CheckCircleIcon : item.tone === 'error' ? AlertCircleIcon : InfoIcon
          return (
            <div key={item.id} className={`toast toast-${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
              <Icon size={16} />
              <div className="toast-body">
                <strong>{item.title}</strong>
                {item.description ? <span>{item.description}</span> : null}
              </div>
              <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
                <XIcon size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast must be used inside <ToastProvider>.')
  return toast
}
