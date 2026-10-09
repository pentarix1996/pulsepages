'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'
import { useToast } from '@/components/ui/Toast'
import { AppRequestError } from './api'

/**
 * Runs a mutation, shows a toast and refreshes Server Components. Returns field errors for forms.
 * `const { run, pending, fieldErrors } = useAction()`; `await run(() => appRequest(...), { success: 'Saved' })`.
 */
export function useAction() {
  const router = useRouter()
  const toast = useToast()
  const [pending, setPending] = useState(false)
  const [, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const run = useCallback(
    async <T,>(action: () => Promise<T>, options: { success?: string; successDescription?: string; refresh?: boolean; errorTitle?: string } = {}): Promise<T | undefined> => {
      setPending(true)
      setFieldErrors({})
      try {
        const result = await action()
        if (options.success) toast.success(options.success, options.successDescription)
        if (options.refresh !== false) startTransition(() => router.refresh())
        return result
      } catch (error) {
        if (error instanceof AppRequestError) {
          setFieldErrors(error.fieldErrors())
          toast.error(options.errorTitle ?? error.message, options.errorTitle ? error.message : undefined)
        } else {
          toast.error('Something went wrong', 'Try again in a moment.')
        }
        return undefined
      } finally {
        setPending(false)
      }
    },
    [router, toast],
  )

  return { run, pending, fieldErrors, setFieldErrors }
}
