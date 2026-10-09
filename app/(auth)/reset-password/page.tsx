import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/AuthShell'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import { ButtonLink } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Choose a new password' }

/** Reached from the reset email through /auth/callback, which signs the person in for this step. */
export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Reset links work once, for a limited time, in the browser where you asked for them."
        footer={
          <Link className="link" href="/login">
            Back to sign in
          </Link>
        }
      >
        <ButtonLink variant="primary" href="/forgot-password" className="auth-submit">
          Request a new link
        </ButtonLink>
      </AuthShell>
    )
  }
  return (
    <AuthShell title="Choose a new password" subtitle={`For ${data.user.email ?? 'your account'}. You stay signed in on this device.`}>
      <ResetPasswordForm />
    </AuthShell>
  )
}
