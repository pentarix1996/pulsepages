'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, type ButtonVariant } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'

/** Signs out and opens the sign-in page for the same invitation (wrong account case). */
export function SwitchAccountButton({ invite, variant = 'primary', children = 'Sign in with another account' }: { invite: string; variant?: ButtonVariant; children?: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  return (
    <Button
      variant={variant}
      loading={pending}
      onClick={async () => {
        setPending(true)
        await createClient().auth.signOut()
        router.replace(`/login?invite=${encodeURIComponent(invite)}`)
        router.refresh()
      }}
    >
      {children}
    </Button>
  )
}
