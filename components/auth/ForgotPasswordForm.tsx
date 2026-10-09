'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { MailIcon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { AuthError } from './AuthShell'
import { authErrorMessage, isUnknownAccountError } from './errors'
import { callbackUrl } from './safe-next'

export function ForgotPasswordForm({ initialEmail }: { initialEmail?: string | null }) {
  const [email, setEmail] = useState(initialEmail ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter the email address you sign in with.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(address, { redirectTo: callbackUrl(window.location.origin, '/reset-password') })
      // Same answer for unknown addresses, so the form does not reveal who has an account.
      if (resetError && !isUnknownAccountError(resetError)) setError(authErrorMessage(resetError))
      else setSentTo(address)
    } catch {
      setError('Could not reach Upvane. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  if (sentTo) {
    return (
      <div className="auth-sent" role="status">
        <MailIcon size={18} />
        <div className="stack" style={{ ['--gap' as string]: '4px' }}>
          <strong>Check your inbox</strong>
          <span className="muted">
            If an account exists for <span className="mono">{sentTo}</span>, a link to choose a new password is on its way. Open it in this browser; it works once.
          </span>
        </div>
      </div>
    )
  }

  return (
    <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
      <AuthError message={error} />
      <Field label="Email">
        {(props) => <Input {...props} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus required />}
      </Field>
      <Button type="submit" variant="primary" className="auth-submit" loading={pending}>
        Email me a reset link
      </Button>
    </form>
  )
}
