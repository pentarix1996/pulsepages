'use client'

import { useState } from 'react'
import { PASSWORD_MAX_LENGTH } from '@/components/auth/password'
import { PasswordInput, PasswordRule } from '@/components/auth/PasswordInput'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { AccountResource } from '@/lib/domain/schemas/account'
import { formatDate } from '@/lib/format'

export function AccountManager({ account, confirmOther }: { account: AccountResource; confirmOther: boolean }) {
  return (
    <div className="settings-grid">
      <ProfileCard account={account} />
      <EmailCard account={account} confirmOther={confirmOther} />
      <PasswordCard />
    </div>
  )
}

function ProfileCard({ account }: { account: AccountResource }) {
  const [name, setName] = useState(account.name ?? '')
  const { run, pending, fieldErrors } = useAction()
  const dirty = name.trim() !== (account.name ?? '') && name.trim().length > 0

  return (
    <Card>
      <CardHeader title="Profile" description="Your name appears in the members list, invitations and incident timelines." />
      <form
        className="card-b stack"
        onSubmit={(event) => {
          event.preventDefault()
          void run(() => appRequest('/account', { method: 'PATCH', body: { name } }), { success: 'Name saved' })
        }}
      >
        <Field label="Name" error={fieldErrors.name}>
          {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={80} required />}
        </Field>
        <div className="kv-list">
          <div className="kv">
            <span>Username</span>
            <span className="mono">{account.username ?? '—'}</span>
          </div>
          <div className="kv">
            <span>Member since</span>
            <span>{formatDate(account.created_at)}</span>
          </div>
        </div>
        <p className="help">Your username is also the URL of your personal workspace (/status/{account.username ?? 'username'}/…) and cannot be changed.</p>
        <div className="settings-actions">
          <Button type="submit" variant={dirty ? 'primary' : 'ghost'} loading={pending} disabled={!dirty}>
            Save name
          </Button>
        </div>
      </form>
    </Card>
  )
}

function EmailCard({ account, confirmOther }: { account: AccountResource; confirmOther: boolean }) {
  const [email, setEmail] = useState('')
  const [pendingEmail, setPendingEmail] = useState<string | null>(account.new_email)
  const { run, pending, fieldErrors } = useAction()
  const toast = useToast()
  const dirty = email.trim().length > 0

  const submit = async () => {
    const result = await run(() => appRequest<{ changed: boolean; pending_email: string | null }>('/account/email', { body: { email } }), { refresh: true })
    if (!result) return
    if (!result.changed) {
      toast.info('That is already your email address', 'Nothing changed.')
      return
    }
    setEmail('')
    if (result.pending_email) {
      setPendingEmail(result.pending_email)
      toast.success('Check your inbox to confirm the new address', `We sent a link to ${result.pending_email}. Your email changes once you open it.`)
    } else {
      toast.success('Email changed')
    }
  }

  return (
    <Card>
      <CardHeader title="Email" description="Where Upvane sends sign-in links, invitations and alerts you subscribe to." />
      <form
        className="card-b stack"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="kv-list">
          <div className="kv">
            <span>Current address</span>
            <span className="mono">{account.email ?? '—'}</span>
          </div>
        </div>
        {confirmOther ? (
          <Banner tone="info">One confirmation link accepted. Open the link we sent to your other address to finish the change.</Banner>
        ) : pendingEmail ? (
          <Banner tone="info">
            Waiting for confirmation of <span className="mono">{pendingEmail}</span>. Open the link we emailed to finish the change. If asked, confirm from your current address too.
          </Banner>
        ) : null}
        <Field label="New email address" error={fieldErrors.email}>
          {(props) => <Input {...props} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required />}
        </Field>
        <div className="settings-actions">
          <Button type="submit" variant={dirty ? 'primary' : 'ghost'} loading={pending} disabled={!dirty}>
            Change email
          </Button>
        </div>
      </form>
    </Card>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const { run, pending, fieldErrors } = useAction()
  const dirty = current.length > 0 && next.length > 0

  return (
    <Card>
      <CardHeader title="Password" description="You stay signed in on this device. Other devices keep their sessions until they expire." />
      <form
        className="card-b stack"
        onSubmit={async (event) => {
          event.preventDefault()
          const done = await run(() => appRequest('/account/password', { body: { current_password: current, password: next } }).then(() => true), {
            success: 'Password changed',
            successDescription: 'Use it the next time you sign in.',
            refresh: false,
          })
          if (done) {
            setCurrent('')
            setNext('')
          }
        }}
      >
        <Field label="Current password" error={fieldErrors.current_password}>
          {(props) => <PasswordInput {...props} value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />}
        </Field>
        <Field label="New password" error={fieldErrors.password} hint={<PasswordRule password={next} />}>
          {(props) => <PasswordInput {...props} value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} required />}
        </Field>
        <p className="help">
          Signed up with a link and never set a password? <a className="link" href="/forgot-password">Set one by email</a>.
        </p>
        <div className="settings-actions">
          <Button type="submit" variant={dirty ? 'primary' : 'ghost'} loading={pending} disabled={!dirty}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  )
}
