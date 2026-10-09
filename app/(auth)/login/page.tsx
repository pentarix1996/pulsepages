import type { Metadata } from 'next'
import Link from 'next/link'
import { ROLE_ARTICLE_LABEL } from '@/components/auth/copy'
import { AuthShell } from '@/components/auth/AuthShell'
import { LoginForm, type LoginMode } from '@/components/auth/LoginForm'
import { firstParam, type SearchParams } from '@/components/auth/params'
import { authQuery, isInviteToken } from '@/components/auth/safe-next'
import { getInvitationPreview } from '@/lib/domain/invitations'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const next = firstParam(params, 'next')
  const invite = firstParam(params, 'invite')
  const preview = isInviteToken(invite) ? await getInvitationPreview(invite) : null
  const mode = firstParam(params, 'mode')
  const initialMode: LoginMode = mode === 'sso' || mode === 'link' ? mode : 'password'

  return (
    <AuthShell
      title="Sign in"
      subtitle={
        preview
          ? `Sign in to join ${preview.organization.name} as ${ROLE_ARTICLE_LABEL[preview.role]}.`
          : 'Welcome back. Your status pages, monitors and incidents are where you left them.'
      }
      footer={
        <>
          New to Upvane?{' '}
          <Link className="link" href={`/register${authQuery({ next, invite })}`}>
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={next} invite={isInviteToken(invite) ? invite : null} initialEmail={firstParam(params, 'email')} initialMode={initialMode} linkError={firstParam(params, 'error')} />
    </AuthShell>
  )
}
