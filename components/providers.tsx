'use client'

import type { ReactNode } from 'react'
import { ConfirmProvider } from '@/components/ui/Dialog'
import { ToastProvider } from '@/components/ui/Toast'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  )
}
