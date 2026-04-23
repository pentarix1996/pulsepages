'use client'

import { type ReactNode } from 'react'
import { useToast } from '@/hooks/useToast'
import { StoreProvider } from '@/lib/store/provider'

interface StoreProviderWithToastProps {
  children: ReactNode
}

export function StoreProviderWithToast({ children }: StoreProviderWithToastProps) {
  const { addToast } = useToast()

  return (
    <StoreProvider toastFn={addToast}>
      {children}
    </StoreProvider>
  )
}
