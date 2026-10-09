import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/AuthShell'
import { LINK_ERROR_MESSAGES } from '@/components/auth/errors'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { firstParam, type SearchParams } from '@/components/auth/params'
import { authQuery } from '@/components/auth/safe-next'
import { Banner } from '@/components/ui/Banner'

export const metadata: Metadata = { title: 'Reset your password' }

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const error = firstParam(params, 'error')
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We email you a link to choose a new password."
      footer={
        <Link className="link" href={`/login${authQuery({ next: firstParam(params, 'next'), invite: firstParam(params, 'invite') })}`}>
          Back to sign in
        </Link>
      }
    >
      {error && LINK_ERROR_MESSAGES[error] ? <Banner tone="danger">{LINK_ERROR_MESSAGES[error]}</Banner> : null}
      <ForgotPasswordForm initialEmail={firstParam(params, 'email')} />
    </AuthShell>
  )
}
