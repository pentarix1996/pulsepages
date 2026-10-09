'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { ArrowRightIcon, KeyIcon, MailIcon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { AuthError } from './AuthShell'
import { authErrorMessage, isUnknownAccountError, LINK_ERROR_MESSAGES } from './errors'
import { PasswordInput } from './PasswordInput'
import { authDestination, authQuery, callbackUrl } from './safe-next'
import { ssoDomainFrom } from './sso'

export type LoginMode = 'password' | 'link' | 'sso'
type Mode = LoginMode

interface Props {
  next: string | null
  invite: string | null
  initialEmail?: string | null
  initialMode?: Mode
  linkError?: string | null
}

export function LoginForm({ next, invite, initialEmail, initialMode = 'password', linkError }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [ssoValue, setSsoValue] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(linkError ? LINK_ERROR_MESSAGES[linkError] ?? null : null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const destination = authDestination({ next, invite })

  const switchMode = (value: Mode) => {
    setMode(value)
    setError(null)
    setNotice(null)
    setUnconfirmed(false)
    setLinkSentTo(null)
  }

  const signInWithPassword = async () => {
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) {
      setUnconfirmed(signInError.code === 'email_not_confirmed')
      setError(authErrorMessage(signInError))
      return false
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const target = aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2' ? `/login/verify?next=${encodeURIComponent(destination)}` : destination
    router.replace(target)
    router.refresh()
    return true
  }

  const sendLink = async () => {
    const supabase = createClient()
    const address = email.trim()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false, emailRedirectTo: callbackUrl(window.location.origin, destination) },
    })
    // Unknown addresses get the same answer, so the form does not reveal who has an account.
    if (otpError && !isUnknownAccountError(otpError)) {
      setError(authErrorMessage(otpError))
      return false
    }
    setLinkSentTo(address)
    return false
  }

  const signInWithSso = async () => {
    const domain = ssoDomainFrom(ssoValue)
    if (!domain) {
      setError('Enter your work email (jane@acme.com) or your company domain (acme.com).')
      return false
    }
    const supabase = createClient()
    const { data, error: ssoError } = await supabase.auth.signInWithSSO({
      domain,
      options: { redirectTo: callbackUrl(window.location.origin, destination), skipBrowserRedirect: true },
    })
    if (ssoError || !data?.url) {
      setError(ssoError ? authErrorMessage(ssoError).replace('that domain', domain) : `Single sign-on isn't set up for ${domain}.`)
      return false
    }
    window.location.assign(data.url)
    return true
  }

  const resendConfirmation = async () => {
    setPending(true)
    const supabase = createClient()
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: callbackUrl(window.location.origin, destination) } })
    setPending(false)
    setUnconfirmed(false)
    if (resendError) setError(authErrorMessage(resendError))
    else {
      setError(null)
      setNotice(`We sent a new confirmation link to ${email.trim()}.`)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    setNotice(null)
    let navigating = false
    try {
      navigating = mode === 'password' ? await signInWithPassword() : mode === 'link' ? await sendLink() : await signInWithSso()
    } catch {
      setError('Could not reach Upvane. Check your connection and try again.')
    } finally {
      if (!navigating) setPending(false)
    }
  }

  if (mode === 'link' && linkSentTo) {
    return (
      <div className="stack" style={{ ['--gap' as string]: '14px' }} role="status">
        <div className="auth-sent">
          <MailIcon size={18} />
          <div className="stack" style={{ ['--gap' as string]: '4px' }}>
            <strong>Check your inbox</strong>
            <span className="muted">
              If an account exists for <span className="mono">{linkSentTo}</span>, a sign-in link is on its way. Open it in this browser; it works once.
            </span>
          </div>
        </div>
        <Button variant="ghost" onClick={() => switchMode('password')}>
          Sign in with a password instead
        </Button>
      </div>
    )
  }

  return (
    <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit} noValidate>
      <AuthError
        message={error}
        action={
          unconfirmed ? (
            <Button size="sm" variant="ghost" onClick={resendConfirmation} disabled={pending}>
              Resend link
            </Button>
          ) : null
        }
      />
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      {mode === 'sso' ? (
        <Field label="Work email or company domain" hint="We send you to your company's identity provider.">
          {(props) => (
            <Input {...props} value={ssoValue} onChange={(event) => setSsoValue(event.target.value)} placeholder="jane@acme.com" autoComplete="email" inputMode="email" autoFocus required />
          )}
        </Field>
      ) : (
        <Field label="Email">
          {(props) => (
            <Input {...props} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus={!initialEmail} required />
          )}
        </Field>
      )}

      {mode === 'password' ? (
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <Field label="Password">
            {(props) => <PasswordInput {...props} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus={Boolean(initialEmail)} required />}
          </Field>
          <Link className="link auth-forgot" href={`/forgot-password${authQuery({ next, invite, email: email.trim() || null })}`}>
            Forgot your password?
          </Link>
        </div>
      ) : null}

      <Button type="submit" variant="primary" className="auth-submit" loading={pending}>
        {mode === 'password' ? 'Sign in' : mode === 'link' ? 'Email me a sign-in link' : 'Continue with SSO'}
      </Button>

      <div className="auth-or" aria-hidden="true">
        or
      </div>
      <div className="auth-alt">
        {mode !== 'password' ? (
          <Button variant="ghost" icon={<ArrowRightIcon size={15} />} onClick={() => switchMode('password')}>
            Sign in with a password
          </Button>
        ) : null}
        {mode !== 'link' ? (
          <Button variant="ghost" icon={<MailIcon size={15} />} onClick={() => switchMode('link')}>
            Email me a sign-in link
          </Button>
        ) : null}
        {mode !== 'sso' ? (
          <Button variant="ghost" icon={<KeyIcon size={15} />} onClick={() => switchMode('sso')}>
            Sign in with SSO
          </Button>
        ) : null}
      </div>
    </form>
  )
}
