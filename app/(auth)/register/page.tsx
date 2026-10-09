import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/AuthShell'
import { ROLE_ARTICLE_LABEL } from '@/components/auth/copy'
import { firstParam, type SearchParams } from '@/components/auth/params'
import { RegisterForm } from '@/components/auth/RegisterForm'
import { authQuery, isInviteToken } from '@/components/auth/safe-next'
import { getInvitationPreview } from '@/lib/domain/invitations'

export const metadata: Metadata = { title: 'Create your account' }

export default async function RegisterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const next = firstParam(params, 'next')
  const invite = firstParam(params, 'invite')
  const preview = isInviteToken(invite) ? await getInvitationPreview(invite) : null

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        preview
          ? `Then you join ${preview.organization.name} as ${ROLE_ARTICLE_LABEL[preview.role]}. Use the address the invitation was sent to (${preview.email_hint}).`
          : 'Status pages, multi-region monitoring and incident updates for on-call teams. Free to start.'
      }
      footer={
        <>
          Already have an account?{' '}
          <Link className="link" href={`/login${authQuery({ next, invite })}`}>
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm next={next} invite={isInviteToken(invite) ? invite : null} />
    </AuthShell>
  )
}
