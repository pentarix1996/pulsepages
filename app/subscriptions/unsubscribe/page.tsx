import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { readSubscription, subscriptionPage, unsubscribe } from '@/lib/status-page/subscriptions'
import { SubscriptionShell } from '../_shell'
import '@/styles/status.css'

export const metadata: Metadata = { title: { absolute: 'Unsubscribe' }, robots: { index: false } }

async function leave(formData: FormData) {
  'use server'
  const result = await unsubscribe(String(formData.get('token') ?? ''))
  redirect(`/subscriptions/unsubscribe?result=done${result ? `&page=${encodeURIComponent(result.project_id)}` : ''}`)
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; result?: string; page?: string }> }) {
  const { token, result, page: pageId } = await searchParams

  if (result === 'done') {
    const page = pageId && /^[0-9a-f-]{36}$/i.test(pageId) ? await subscriptionPage(pageId) : null
    return (
      <SubscriptionShell page={page}>
        <h1>You are unsubscribed</h1>
        <p className="sp-muted">You will not get more updates{page ? ` from ${page.name}` : ''}. You can subscribe again from the status page at any time.</p>
        {page ? (
          <a className="sp-btn sp-btn-quiet" href={page.url}>
            Back to the status page
          </a>
        ) : null}
      </SubscriptionShell>
    )
  }

  const subscription = token ? await readSubscription(token) : null
  if (!token || !subscription) {
    return (
      <SubscriptionShell page={null}>
        <h1>Already unsubscribed</h1>
        <p className="sp-muted">This link was already used, or it is incomplete. No more updates go to this address.</p>
      </SubscriptionShell>
    )
  }

  const page = await subscriptionPage(subscription.project_id)
  const target = subscription.email ?? subscription.target_hint ?? 'this subscription'
  return (
    <SubscriptionShell page={page}>
      <h1>Unsubscribe from updates?</h1>
      <p className="sp-muted">
        <strong>{target}</strong> stops getting incident and maintenance updates{page ? ` from ${page.name}` : ''}.
      </p>
      <form action={leave}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="sp-btn sp-btn-accent">
          Unsubscribe
        </button>
      </form>
    </SubscriptionShell>
  )
}
