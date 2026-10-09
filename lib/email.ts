import 'server-only'
import { env } from '@/lib/env'

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
  /** Resend idempotency key, so retries never send twice. */
  idempotencyKey?: string
}

export type EmailResult = { ok: true; id: string | null; provider: 'resend' | 'mailpit' } | { ok: false; error: string; retryable: boolean }

/**
 * Sends transactional email from Next (invitations, recipient verification, subscription confirmations).
 * Resend in production; Mailpit's HTTP API in local development (LOCAL_MAILPIT_URL); otherwise reports
 * `email_not_configured` so the UI can say so instead of pretending it worked.
 */
export async function sendEmail(message: OutgoingEmail): Promise<EmailResult> {
  const resendKey = env.resendApiKey()
  const from = env.emailFrom()
  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
          ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
        },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text, headers: message.headers }),
      })
      const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string }
      if (!response.ok) return { ok: false, error: payload.message ?? `Resend answered ${response.status}.`, retryable: response.status === 429 || response.status >= 500 }
      return { ok: true, id: payload.id ?? null, provider: 'resend' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not reach Resend.', retryable: true }
    }
  }

  const mailpit = process.env.LOCAL_MAILPIT_URL
  if (mailpit) {
    const fromMatch = /^(.*)<(.+)>$/.exec(from)
    const response = await fetch(`${mailpit.replace(/\/+$/, '')}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: (fromMatch?.[2] ?? from).trim(), Name: (fromMatch?.[1] ?? 'Upvane').trim() },
        To: [{ Email: message.to }],
        Subject: message.subject,
        HTML: message.html,
        Text: message.text,
        Headers: message.headers,
      }),
    }).catch(() => null)
    if (response?.ok) {
      const payload = (await response.json().catch(() => ({}))) as { ID?: string }
      return { ok: true, id: payload.ID ?? null, provider: 'mailpit' }
    }
    return { ok: false, error: 'Mailpit did not accept the message.', retryable: true }
  }

  return { ok: false, error: 'email_not_configured', retryable: false }
}
