import 'server-only'
// Public subscriptions from the status page: email (double opt-in), Slack incoming webhooks and signed webhooks.
// Validation and the calls to subscribe_to_status_page() live here; the route handler adds rate limiting, the
// honeypot and the response format.
import { lookup } from 'node:dns/promises'
import { z } from 'zod'
import { validateChatWebhookUrl } from '@shared/alerts/targets.ts'
import { encryptJson, generateToken, secretHint, sha256Hex } from '@shared/crypto.ts'
import { renderSubscriptionConfirmationEmail } from '@shared/emails.ts'
import { validateMonitorUrlWithDns, type DnsResolver } from '@shared/monitoring/ssrf.ts'
import { confirmSubscriptionUrl, subscriberKey, unsubscribeTokenHash } from '@shared/subscribers.ts'
import { DomainError, invalid } from '@/lib/domain/errors'
import { sendEmail, type OutgoingEmail, type EmailResult } from '@/lib/email'
import { env } from '@/lib/env'
import { adminRpc, StatusPageLoadError } from './data'
import type { StatusPageData } from './types'
import { pageTitle } from './view'

/** Field that people never see; bots fill it in. */
export const HONEYPOT_FIELD = 'company'

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Unknown component.')
const componentIds = z.array(uuid).max(500, 'Choose fewer components.').optional()
const targetUrl = (missing: string) => z.string({ error: missing }).trim().min(1, missing).max(2048, 'The URL is too long.')

export const subscribeInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    email: z
      .string({ error: 'Enter your email address.' })
      .trim()
      .toLowerCase()
      .min(1, 'Enter your email address.')
      .max(254, 'That email address is too long.')
      .pipe(z.email('Enter a full email address, like you@company.com.')),
    component_ids: componentIds,
  }),
  z.object({ type: z.literal('slack'), url: targetUrl('Paste the Slack webhook URL.'), component_ids: componentIds }),
  z.object({ type: z.literal('webhook'), url: targetUrl('Enter the URL that should receive updates.'), component_ids: componentIds }),
])
export type SubscribeInput = z.infer<typeof subscribeInput>

export type SubscribeOutcome =
  | { result: 'confirmation_sent'; message: string }
  | { result: 'already_subscribed'; message: string }
  | { result: 'subscribed'; message: string; signing_secret?: string }

/** Turns a JSON body or form fields into the shape subscribeInput expects. */
export function normalizeSubscribeFields(raw: Record<string, unknown>): Record<string, unknown> {
  const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : 'email'
  let ids: unknown = raw.component_ids
  if (typeof ids === 'string') ids = ids.split(',').map((id) => id.trim()).filter(Boolean)
  const out: Record<string, unknown> = { type }
  if (Array.isArray(ids) && ids.length > 0) out.component_ids = ids
  if (type === 'email') out.email = raw.email
  else out.url = raw.url ?? raw.webhook_url
  return out
}

function fieldError(path: string, message: string): DomainError {
  return invalid(message, [{ path, message }])
}

/** node:dns lookup (A and AAAA, honours the OS resolver), as the SSRF validator expects. */
export const resolveWithLookup: DnsResolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)

export interface SubscribeDeps {
  secretsKey: () => string
  appUrl: () => string
  rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<T | null>
  sendEmail: (message: OutgoingEmail) => Promise<EmailResult>
  resolve: DnsResolver
}

const defaultDeps: SubscribeDeps = { secretsKey: env.secretsKey, appUrl: env.appUrl, rpc: adminRpc, sendEmail, resolve: resolveWithLookup }

const LIMIT_MESSAGE = 'This status page has reached its subscriber limit. Follow the RSS feed instead, or try again later.'

/** Maps errors from subscribe_to_status_page() to answers a visitor understands. */
function subscriptionError(error: unknown): DomainError | 'duplicate' {
  const cause = error instanceof StatusPageLoadError ? error.cause : (error as { code?: string; message?: string })
  if (cause?.code === '23505') return 'duplicate'
  if (cause?.code === 'P0001' && /subscribers/i.test(cause.message ?? '')) return new DomainError('conflict', LIMIT_MESSAGE)
  if (cause?.code === '22023') return fieldError('component_ids', 'Choose components from this status page.')
  console.error('[status-page] subscribe failed', cause)
  return new DomainError('unavailable', 'We could not save your subscription. Try again in a few minutes.')
}

/**
 * Subscribes to a page the caller can see (the route checks access first). Email: stores the confirmation and
 * unsubscribe hashes and sends the confirmation email. Slack: pinned to hooks.slack.com. Webhook: public https URL
 * (DNS-checked against private ranges) with a signing secret that is returned once.
 */
export async function subscribeToPage(page: StatusPageData, input: SubscribeInput, deps: SubscribeDeps = defaultDeps): Promise<SubscribeOutcome> {
  const projectId = page.project.id
  const known = new Set(page.components.map((component) => component.id))
  const components = [...new Set(input.component_ids ?? [])]
  if (components.some((id) => !known.has(id))) throw fieldError('component_ids', 'Choose components from this status page.')

  const key = deps.secretsKey()
  const base = { p_project_id: projectId, p_type: input.type, p_component_ids: components }

  if (input.type === 'email') {
    const token = generateToken('sub_')
    const confirmHash = await sha256Hex(token)
    const unsubscribeHash = await unsubscribeTokenHash(key, projectId, subscriberKey({ type: 'email', email: input.email }))
    let outcome: string | null
    try {
      outcome = await deps.rpc<string>('subscribe_to_status_page', {
        ...base,
        p_email: input.email,
        p_target_encrypted: null,
        p_target_hint: null,
        p_confirm_token_hash: confirmHash,
        p_unsubscribe_token_hash: unsubscribeHash,
      })
    } catch (error) {
      const mapped = subscriptionError(error)
      if (mapped === 'duplicate') return { result: 'already_subscribed', message: `${input.email} is already subscribed.` }
      throw mapped
    }
    if (outcome === 'already_confirmed') return { result: 'already_subscribed', message: `${input.email} is already subscribed.` }
    const rendered = renderSubscriptionConfirmationEmail({
      pageName: pageTitle(page.project),
      confirmUrl: confirmSubscriptionUrl(deps.appUrl(), token),
      brandColor: page.project.brand_color,
      logoUrl: page.project.logo_url,
    })
    const sent = await deps.sendEmail({ to: input.email, ...rendered, idempotencyKey: `subscription-confirm:${confirmHash.slice(0, 24)}` })
    if (!sent.ok) {
      console.error('[status-page] confirmation email failed', sent.error)
      throw new DomainError('unavailable', 'We could not send the confirmation email right now. Try again in a few minutes.')
    }
    return { result: 'confirmation_sent', message: `Check your inbox to confirm. We sent a link to ${input.email}.` }
  }

  let url: string
  let encrypted: string
  let signingSecret: string | undefined
  if (input.type === 'slack') {
    const checked = validateChatWebhookUrl('slack', input.url)
    if (!checked.ok) throw fieldError('url', checked.reason)
    url = checked.url ?? input.url
    encrypted = await encryptJson({ webhook_url: url }, key)
  } else {
    const checked = await validateMonitorUrlWithDns(input.url, deps.resolve)
    if (!checked.ok) throw fieldError('url', checked.reason)
    url = checked.url ?? input.url
    signingSecret = generateToken('whsec_')
    encrypted = await encryptJson({ url, signing_secret: signingSecret }, key)
  }
  const unsubscribeHash = await unsubscribeTokenHash(key, projectId, subscriberKey({ type: input.type, targetUrl: url }))
  try {
    await deps.rpc<string>('subscribe_to_status_page', {
      ...base,
      p_email: null,
      p_target_encrypted: encrypted,
      p_target_hint: secretHint(url),
      p_confirm_token_hash: null,
      p_unsubscribe_token_hash: unsubscribeHash,
    })
  } catch (error) {
    const mapped = subscriptionError(error)
    if (mapped === 'duplicate') {
      return {
        result: 'already_subscribed',
        message: input.type === 'slack' ? 'This Slack webhook is already subscribed.' : 'This URL is already subscribed. Keep using the signing secret you saved when you added it.',
      }
    }
    throw mapped
  }
  if (input.type === 'slack') return { result: 'subscribed', message: 'Connected. Updates will post to your Slack channel.' }
  return {
    result: 'subscribed',
    message: 'Webhook added. Copy the signing secret now: we show it only once.',
    signing_secret: signingSecret,
  }
}
