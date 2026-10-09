'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { authErrorMessage } from '@/components/auth/errors'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/Code'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Field, Input } from '@/components/ui/Field'
import { ShieldIcon, TrashIcon } from '@/components/ui/icons'
import { Chip } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import { useToast } from '@/components/ui/Toast'
import { createClient } from '@/lib/supabase/client'

interface Factor {
  id: string
  name: string
  created_at: string
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function SecurityManager({ factors, requiredBy, redirected, email }: { factors: Factor[]; requiredBy: string[]; redirected: boolean; email: string | null }) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [enrolling, setEnrolling] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const enabled = factors.length > 0
  const required = requiredBy.length > 0

  const remove = async (factor: Factor) => {
    const last = factors.length === 1
    const ok = await confirm({
      title: `Remove ${factor.name}?`,
      description:
        last && required
          ? `${joinNames(requiredBy)} ${requiredBy.length === 1 ? 'requires' : 'require'} two-factor authentication: you will have to add another authenticator before you can use Upvane again.`
          : last
            ? 'Signing in will only need your password or an email link.'
            : 'You can still sign in with your other authenticator.',
      confirmLabel: 'Remove authenticator',
    })
    if (!ok) return
    setRemoving(factor.id)
    const { error } = await createClient().auth.mfa.unenroll({ factorId: factor.id })
    setRemoving(null)
    if (error) {
      toast.error('Could not remove the authenticator', authErrorMessage(error))
      return
    }
    toast.success('Authenticator removed')
    router.refresh()
  }

  const signOutEverywhere = async () => {
    const ok = await confirm({
      title: 'Sign out everywhere?',
      description: 'Every browser and device signed in to your account is signed out, including this one.',
      confirmLabel: 'Sign out everywhere',
    })
    if (!ok) return
    const { error } = await createClient().auth.signOut({ scope: 'global' })
    if (error) {
      toast.error('Could not sign out everywhere', authErrorMessage(error))
      return
    }
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="settings-grid">
      {required && !enabled ? (
        <Banner tone="warning">
          {joinNames(requiredBy)} {requiredBy.length === 1 ? 'requires' : 'require'} two-factor authentication.{' '}
          {redirected ? 'Add an authenticator app to keep using Upvane.' : 'Add an authenticator app to keep access.'}
        </Banner>
      ) : null}
      {required && enabled && redirected ? (
        <Banner tone="success" action={<ButtonLink size="sm" variant="ghost" href="/projects">Continue</ButtonLink>}>
          Two-factor authentication is on. You can use Upvane again.
        </Banner>
      ) : null}

      <Card>
        <CardHeader
          title={
            <span className="row" style={{ ['--gap' as string]: '10px' }}>
              Two-factor authentication
              {enabled ? <Chip tone="success">On</Chip> : <Chip>Off</Chip>}
            </span>
          }
          description="After your password or sign-in link, Upvane asks for a 6-digit code from an authenticator app such as 1Password, Google Authenticator or Authy."
          actions={
            <Button variant={enabled ? 'ghost' : 'primary'} size="sm" icon={<ShieldIcon size={14} />} onClick={() => setEnrolling(true)}>
              {enabled ? 'Add another authenticator' : 'Set up authenticator app'}
            </Button>
          }
        />
        {enabled ? (
          <div className="tbl" role="table" aria-label="Authenticator apps" style={{ ['--cols' as string]: 'minmax(0, 1fr) 160px 44px' }}>
            <div className="tr th" role="row">
              <span role="columnheader">Authenticator</span>
              <span role="columnheader">Added</span>
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            </div>
            {factors.map((factor) => (
              <div className="tr hoverable" role="row" key={factor.id}>
                <span role="cell" className="row truncate" style={{ ['--gap' as string]: '10px' }}>
                  <ShieldIcon size={15} />
                  <span className="truncate">{factor.name}</span>
                </span>
                <span role="cell" className="faint">
                  <RelativeTime value={factor.created_at} />
                </span>
                <span role="cell">
                  <Button variant="quiet" size="sm" iconOnly aria-label={`Remove ${factor.name}`} icon={<TrashIcon size={14} />} loading={removing === factor.id} onClick={() => remove(factor)} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Not set up yet" description="Without a second factor, anyone with your password or access to your inbox can sign in as you and change status pages your customers read." />
        )}
      </Card>

      <Card>
        <CardHeader title="Sessions" description={`Signed in as ${email ?? 'you'}. Lost a laptop or shared a computer? End every session at once.`} actions={<Button variant="danger-ghost" size="sm" onClick={signOutEverywhere}>Sign out everywhere</Button>} />
      </Card>

      {enrolling ? (
        <EnrollDialog
          existingNames={factors.map((factor) => factor.name)}
          onClose={() => setEnrolling(false)}
          onEnabled={() => {
            setEnrolling(false)
            toast.success('Two-factor authentication is on', 'Upvane will ask for a code when you sign in.')
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

interface Enrollment {
  id: string
  qr: string
  secret: string
}

function EnrollDialog({ existingNames, onClose, onEnabled }: { existingNames: string[]; onClose: () => void; onEnabled: () => void }) {
  const defaultName = existingNames.length === 0 ? 'Authenticator app' : `Authenticator app ${existingNames.length + 1}`
  const [name, setName] = useState(defaultName)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const verified = useRef(false)

  const start = async () => {
    setPending(true)
    setError(null)
    const supabase = createClient()
    // Abandoned attempts leave unverified factors behind; clear them so names stay free.
    const { data: listed } = await supabase.auth.mfa.listFactors()
    for (const factor of listed?.all ?? []) {
      if (factor.status !== 'verified' && factor.factor_type === 'totp') await supabase.auth.mfa.unenroll({ factorId: factor.id })
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: name.trim() || defaultName, issuer: 'Upvane' })
    setPending(false)
    if (enrollError || !data) {
      setError(authErrorMessage(enrollError))
      return
    }
    setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  const verify = async () => {
    if (!enrollment) return
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code your app shows for Upvane.')
      return
    }
    setPending(true)
    setError(null)
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrollment.id, code })
    setPending(false)
    if (verifyError) {
      setError(authErrorMessage(verifyError))
      setCode('')
      return
    }
    verified.current = true
    onEnabled()
  }

  const cancel = () => {
    if (enrollment && !verified.current) void createClient().auth.mfa.unenroll({ factorId: enrollment.id })
    onClose()
  }

  return (
    <Dialog
      open
      onClose={cancel}
      title={enrollment ? 'Scan the code' : 'Set up an authenticator app'}
      description={enrollment ? 'Scan the QR code with your authenticator app, or type the secret key, then enter the code it shows.' : 'Name it after the app or device, so you know which one to remove later.'}
      onSubmit={() => void (enrollment ? verify() : start())}
      footer={
        <>
          <Button onClick={cancel}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {enrollment ? 'Verify and turn on' : 'Continue'}
          </Button>
        </>
      }
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {enrollment ? (
        <div className="enroll">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI from Supabase */}
          <img className="enroll-qr" src={enrollment.qr} alt="QR code to add Upvane to your authenticator app" width={176} height={176} />
          <div className="stack" style={{ ['--gap' as string]: '14px' }}>
            <div className="stack" style={{ ['--gap' as string]: '6px' }}>
              <span className="field-label">Secret key</span>
              <div className="secret">
                <span className="grow" data-testid="totp-secret">
                  {enrollment.secret}
                </span>
                <CopyButton value={enrollment.secret} />
              </div>
            </div>
            <Field label="6-digit code">
              {(props) => (
                <Input
                  {...props}
                  className="code-input"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  autoFocus
                  required
                />
              )}
            </Field>
          </div>
        </div>
      ) : (
        <Field label="Name">
          {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus required />}
        </Field>
      )}
    </Dialog>
  )
}
