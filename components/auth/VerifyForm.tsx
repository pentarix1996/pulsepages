'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Field'
import { createClient } from '@/lib/supabase/client'
import { AuthError } from './AuthShell'
import { authErrorMessage } from './errors'

interface Factor {
  id: string
  name: string
}

/** Second step of sign-in for people with an authenticator app (TOTP). */
export function VerifyForm({ factors, next }: { factors: Factor[]; next: string }) {
  const router = useRouter()
  const [factorId, setFactorId] = useState(factors[0]?.id ?? '')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const verify = async (value: string) => {
    if (pending || value.length !== 6) return
    setPending(true)
    setError(null)
    let navigating = false
    try {
      const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: value })
      if (verifyError) {
        setError(authErrorMessage(verifyError))
        setCode('')
        inputRef.current?.focus()
        return
      }
      navigating = true
      router.replace(next)
      router.refresh()
    } catch {
      setError('Could not reach Upvane. Check your connection and try again.')
    } finally {
      if (!navigating) setPending(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    void verify(code)
  }

  const signOut = async () => {
    await createClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
      <AuthError message={error} />
      {factors.length > 1 ? (
        <Field label="Authenticator">
          {(props) => <Select {...props} value={factorId} onChange={(event) => setFactorId(event.target.value)} options={factors.map((factor) => ({ value: factor.id, label: factor.name }))} />}
        </Field>
      ) : null}
      <Field label="6-digit code" hint="Codes change every 30 seconds.">
        {(props) => (
          <input
            {...props}
            ref={inputRef}
            className="input code-input"
            value={code}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '').slice(0, 6)
              setCode(digits)
              if (digits.length === 6) void verify(digits)
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            placeholder="000000"
            autoFocus
            required
          />
        )}
      </Field>
      <Button type="submit" variant="primary" className="auth-submit" loading={pending}>
        Verify
      </Button>
      <div className="spread">
        <span className="help">Lost your device? Ask the person who runs Upvane for your team to reset two-factor authentication.</span>
        <Button variant="quiet" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </form>
  )
}
