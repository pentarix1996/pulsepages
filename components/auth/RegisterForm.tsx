'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { MailIcon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { AuthError } from './AuthShell'
import { authErrorMessage } from './errors'
import { passwordProblem, PASSWORD_MAX_LENGTH } from './password'
import { PasswordInput, PasswordRule } from './PasswordInput'
import { authDestination, authQuery, callbackUrl } from './safe-next'

export function RegisterForm({ next, invite }: { next: string | null; invite: string | null }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exists, setExists] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [confirmTo, setConfirmTo] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  const destination = authDestination({ next, invite })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = 'Enter your name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address.'
    const problem = passwordProblem(password)
    if (problem) errors.password = problem
    setFieldErrors(errors)
    setError(null)
    setExists(false)
    if (Object.keys(errors).length > 0) return

    setPending(true)
    let navigating = false
    try {
      const supabase = createClient()
      const address = email.trim().toLowerCase()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: address,
        password,
        options: { data: { name: name.trim() }, emailRedirectTo: callbackUrl(window.location.origin, destination) },
      })
      if (signUpError) {
        setExists(signUpError.code === 'user_already_exists' || /already registered/i.test(signUpError.message))
        if (signUpError.code === 'weak_password') setFieldErrors({ password: authErrorMessage(signUpError) })
        else setError(authErrorMessage(signUpError))
        return
      }
      if (data.session) {
        // Email confirmation is off: the account (and its personal workspace) exists and we are signed in.
        navigating = true
        router.replace(destination)
        router.refresh()
        return
      }
      // Confirmation is on (or the address already has an account; Supabase answers the same way on purpose).
      setConfirmTo(address)
    } catch {
      setError('Could not reach Upvane. Check your connection and try again.')
    } finally {
      if (!navigating) setPending(false)
    }
  }

  const resend = async () => {
    if (!confirmTo) return
    setPending(true)
    const { error: resendError } = await createClient().auth.resend({ type: 'signup', email: confirmTo, options: { emailRedirectTo: callbackUrl(window.location.origin, destination) } })
    setPending(false)
    if (resendError) setError(authErrorMessage(resendError))
    else setResent(true)
  }

  if (confirmTo) {
    return (
      <div className="stack" style={{ ['--gap' as string]: '14px' }} role="status">
        <AuthError message={error} />
        <div className="auth-sent">
          <MailIcon size={18} />
          <div className="stack" style={{ ['--gap' as string]: '4px' }}>
            <strong>Confirm your email</strong>
            <span className="muted">
              We sent a link to <span className="mono">{confirmTo}</span>. Open it to finish creating your account{invite ? ' and join the organization' : ''}.
            </span>
          </div>
        </div>
        {resent ? <Banner tone="success">We sent the link again. It can take a minute to arrive.</Banner> : null}
        <Button variant="ghost" onClick={resend} loading={pending} disabled={resent}>
          Resend the link
        </Button>
      </div>
    )
  }

  return (
    <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
      <AuthError
        message={error}
        action={
          exists ? (
            <Link className="btn btn-ghost btn-sm" href={`/login${authQuery({ next, invite, email: email.trim() })}`}>
              Sign in
            </Link>
          ) : null
        }
      />
      <Field label="Name" error={fieldErrors.name}>
        {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Cooper" autoComplete="name" maxLength={80} autoFocus required />}
      </Field>
      <Field label="Work email" error={fieldErrors.email}>
        {(props) => <Input {...props} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jane@company.com" autoComplete="email" required />}
      </Field>
      <Field label="Password" error={fieldErrors.password} hint={<PasswordRule password={password} />}>
        {(props) => <PasswordInput {...props} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} required />}
      </Field>
      <Button type="submit" variant="primary" className="auth-submit" loading={pending}>
        Create account
      </Button>
      <p className="help">By creating an account you agree to the Upvane terms of service and privacy policy. You get a free personal workspace to start with.</p>
    </form>
  )
}
