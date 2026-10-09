import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/AuthShell'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { verifyAlertRecipientToken } from '@/lib/domain/alerts'
import '@/styles/panel.css'
import '@/styles/panel/settings.css'

export const metadata: Metadata = { title: 'Confirm alerts', robots: { index: false } }

/**
 * Link from the alert recipient confirmation email. Confirming takes a click (POST) so mail scanners that open links
 * cannot confirm on the recipient's behalf.
 */
async function confirmRecipient(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const result = await verifyAlertRecipientToken(token)
  if (!result) redirect('/alerts/verify?result=invalid')
  redirect(`/alerts/verify?result=confirmed${result.project_name ? `&page=${encodeURIComponent(result.project_name.slice(0, 80))}` : ''}`)
}

export default async function VerifyAlertsPage({ searchParams }: { searchParams: Promise<{ token?: string; result?: string; page?: string }> }) {
  const { token, result, page } = await searchParams

  if (result === 'confirmed') {
    return (
      <main className="auth">
        <AuthShell title="You will get alerts" subtitle={page ? `From ${page}` : undefined} footer={<Link className="link" href="/">Upvane</Link>}>
          <p>Your address is confirmed. Alerts start with the next event the team routes to this channel.</p>
          <p className="help">To stop them, ask the team that added you to remove your address.</p>
        </AuthShell>
      </main>
    )
  }

  if (result === 'invalid' || !token) {
    return (
      <main className="auth">
        <AuthShell title="This link does not work" footer={<Link className="link" href="/">Upvane</Link>}>
          <Banner tone="warning">The link was already used or is not complete. If you still get no alerts, ask the team that added you to send a new confirmation.</Banner>
        </AuthShell>
      </main>
    )
  }

  return (
    <main className="auth">
      <AuthShell title="Confirm alert emails" subtitle="A team on Upvane added your address to an alert channel.">
        <form action={confirmRecipient} className="stack">
          <input type="hidden" name="token" value={token} />
          <p>Confirm to receive their alerts about outages, monitors and incidents. Nothing is sent until you do.</p>
          <Button type="submit" variant="primary">
            Confirm and get alerts
          </Button>
        </form>
      </AuthShell>
    </main>
  )
}
