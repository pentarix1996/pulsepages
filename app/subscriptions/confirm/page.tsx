import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { confirmSubscription, subscriptionPage } from '@/lib/status-page/subscriptions'
import { SubscriptionShell } from '../_shell'
import '@/styles/status.css'

export const metadata: Metadata = { title: { absolute: 'Confirm subscription' }, robots: { index: false } }

/** Confirming takes a click (POST), so link scanners in mail systems cannot subscribe people. */
async function confirm(formData: FormData) {
  'use server'
  const result = await confirmSubscription(String(formData.get('token') ?? ''))
  if (!result) redirect('/subscriptions/confirm?result=invalid')
  redirect(`/subscriptions/confirm?result=confirmed&page=${encodeURIComponent(result.project_id)}`)
}

export default async function ConfirmSubscriptionPage({ searchParams }: { searchParams: Promise<{ token?: string; result?: string; page?: string }> }) {
  const { token, result, page: pageId } = await searchParams
  const page = pageId && /^[0-9a-f-]{36}$/i.test(pageId) ? await subscriptionPage(pageId) : null

  if (result === 'confirmed') {
    return (
      <SubscriptionShell page={page}>
        <h1>You are subscribed</h1>
        <p className="sp-muted">You will get an email when an incident is opened, updated or resolved, and before scheduled maintenance. Every email has an unsubscribe link.</p>
        {page ? (
          <a className="sp-btn sp-btn-accent" href={page.url}>
            See current status
          </a>
        ) : null}
      </SubscriptionShell>
    )
  }

  if (result === 'invalid' || !token) {
    return (
      <SubscriptionShell page={null}>
        <h1>This link does not work</h1>
        <p className="sp-muted">It was already used, or it is incomplete. If you are not getting updates, subscribe again from the status page.</p>
      </SubscriptionShell>
    )
  }

  return (
    <SubscriptionShell page={null}>
      <h1>Confirm your subscription</h1>
      <p className="sp-muted">Someone, probably you, asked to get status updates at this address. Confirm to start receiving them.</p>
      <form action={confirm}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="sp-btn sp-btn-accent">
          Confirm subscription
        </button>
      </form>
      <p className="sp-fine">If you did not ask for this, ignore the email. Nothing is sent until you confirm.</p>
    </SubscriptionShell>
  )
}
