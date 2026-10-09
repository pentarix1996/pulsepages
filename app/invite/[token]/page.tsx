import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ORG_ROLE_HINTS, ORG_ROLE_LABELS } from '@shared/domain.ts'
import { AuthShell } from '@/components/auth/AuthShell'
import { ROLE_ARTICLE_LABEL } from '@/components/auth/copy'
import { SwitchAccountButton } from '@/components/auth/SwitchAccountButton'
import { Banner } from '@/components/ui/Banner'
import { ButtonLink } from '@/components/ui/Button'
import { optionalUserContext } from '@/lib/domain/context'
import { acceptInvitation, getInvitationPreview, type InvitationPreview } from '@/lib/domain/invitations'
import { formatDateTime } from '@/lib/format'
import '@/styles/panel.css'
import '@/styles/panel/settings.css'

export const metadata: Metadata = { title: 'Invitation', robots: { index: false } }

const FAILURE_TITLES: Record<string, string> = {
  invalid: 'This invitation is not valid',
  revoked: 'This invitation was cancelled',
  used: 'This invitation was already used',
  expired: 'This invitation has expired',
  wrong_email: 'This invitation is for someone else',
  member_limit: 'The organization is full',
}

function InviteSummary({ preview }: { preview: InvitationPreview }) {
  return (
    <dl className="invite-summary">
      <div className="kv">
        <dt>Organization</dt>
        <dd>{preview.organization.name}</dd>
      </div>
      <div className="kv">
        <dt>Role</dt>
        <dd>{ORG_ROLE_LABELS[preview.role]}</dd>
      </div>
      <div className="kv">
        <dt>Sent to</dt>
        <dd className="mono">{preview.email_hint}</dd>
      </div>
      <div className="kv">
        <dt>Expires</dt>
        <dd>{formatDateTime(preview.expires_at, { withZone: true })}</dd>
      </div>
    </dl>
  )
}

/**
 * Invitation link from the email. Signed in: joins right away and continues to /projects?joined=<org slug>.
 * Signed out: says who invited them where, and offers sign in or sign up carrying ?invite=.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = await optionalUserContext()

  if (ctx) {
    const outcome = await acceptInvitation(ctx, token)
    if (!('message' in outcome)) redirect(`/projects?joined=${encodeURIComponent(outcome.organization.slug)}`)
    return (
      <main className="auth">
        <AuthShell
          title={FAILURE_TITLES[outcome.status] ?? 'This invitation cannot be used'}
          subtitle={outcome.preview ? `${outcome.preview.organization.name} · ${ORG_ROLE_LABELS[outcome.preview.role]}` : undefined}
          footer={
            <Link className="link" href="/projects">
              Go to your status pages
            </Link>
          }
        >
          <Banner tone={outcome.status === 'wrong_email' || outcome.status === 'member_limit' ? 'warning' : 'danger'}>{outcome.message}</Banner>
          {outcome.status === 'wrong_email' ? <SwitchAccountButton invite={token} /> : null}
        </AuthShell>
      </main>
    )
  }

  const preview = await getInvitationPreview(token)
  if (!preview) {
    return (
      <main className="auth">
        <AuthShell title="This invitation is not valid" subtitle="Check that you opened the whole link from the email, or ask for a new invitation.">
          <ButtonLink variant="primary" href="/login" className="auth-submit">
            Sign in
          </ButtonLink>
        </AuthShell>
      </main>
    )
  }

  const inviter = preview.inviter ?? 'Someone'
  if (preview.status !== 'pending') {
    const reason =
      preview.status === 'expired'
        ? `It expired on ${formatDateTime(preview.expires_at, { withZone: true })}.`
        : preview.status === 'accepted'
          ? 'It was already accepted. Sign in to open the organization.'
          : 'It was cancelled or replaced by a newer invitation.'
    return (
      <main className="auth">
        <AuthShell title={FAILURE_TITLES[preview.status === 'accepted' ? 'used' : preview.status] ?? 'This invitation cannot be used'} subtitle={`${inviter} invited you to ${preview.organization.name}. ${reason}`}>
          {preview.status !== 'accepted' ? <Banner tone="warning">Ask {preview.inviter ?? 'an admin of the organization'} to send you a new invitation.</Banner> : null}
          <ButtonLink variant={preview.status === 'accepted' ? 'primary' : 'ghost'} href="/login" className="auth-submit">
            Sign in
          </ButtonLink>
        </AuthShell>
      </main>
    )
  }

  const query = `?invite=${encodeURIComponent(token)}`
  return (
    <main className="auth">
      <AuthShell
        title={`Join ${preview.organization.name}`}
        subtitle={`${inviter} invited you to join ${preview.organization.name} on Upvane as ${ROLE_ARTICLE_LABEL[preview.role]}. ${ORG_ROLE_HINTS[preview.role]}`}
        footer="Use the email address the invitation was sent to."
      >
        <InviteSummary preview={preview} />
        <div className="stack" style={{ ['--gap' as string]: '10px' }}>
          <ButtonLink variant="primary" href={`/register${query}`} className="auth-submit">
            Create an account and join
          </ButtonLink>
          <ButtonLink variant="ghost" href={`/login${query}`} className="auth-submit">
            I have an account, sign in
          </ButtonLink>
        </div>
      </AuthShell>
    </main>
  )
}
