// Prepares one delivery: decides what to send and how, without sending it. alert-worker executes the result, which
// keeps this logic testable from Vitest.
import type { DnsResolver } from '../monitoring/ssrf.ts'
import { validateResolvedHost } from '../monitoring/ssrf.ts'
import { renderSubscriberUpdateEmail, renderTeamAlertEmail } from '../emails.ts'
import { signWebhookPayload, SIGNATURE_HEADER } from './signing.ts'
import { buildAlertMessage, statusPageUrl } from './message.ts'
import { validateChatWebhookUrl, validateWebhookUrl } from './targets.ts'
import { buildDiscordPayload, buildSlackPayload, buildTeamsPayload } from './templates/chat.ts'
import { buildOpsgenieRequest, buildPagerDutyRequest, isPageable } from './templates/paging.ts'
import { buildWebhookBody, WEBHOOK_USER_AGENT } from './templates/webhook.ts'
import type { DeliveryContext, EmailMessage, LinkContext, OutboundRequest } from './types.ts'

export interface DispatchDeps {
  links: LinkContext
  /** Decrypts v1.<iv>.<ct> payloads with UPVANE_SECRETS_KEY. */
  decrypt: (payload: string) => Promise<string>
  /** Builds the unsubscribe URL for a subscriber notification. */
  unsubscribeUrl: (context: DeliveryContext, targetUrl: string | null) => Promise<string>
  /** DNS resolver used to re-check generic webhook targets before sending. */
  resolve?: DnsResolver
}

export type PreparedDelivery =
  | { kind: 'http'; provider: string; request: OutboundRequest }
  | { kind: 'email'; provider: 'resend'; email: EmailMessage }
  | { kind: 'skip'; code: string; reason: string }

interface ChatSecret {
  webhook_url?: string
}
interface WebhookSecret {
  url?: string
  signing_secret?: string | null
}
interface PagingSecret {
  routing_key?: string
  api_key?: string
}

async function readSecret<T>(deps: DispatchDeps, payload: string | null): Promise<T | null> {
  if (!payload) return null
  try {
    return JSON.parse(await deps.decrypt(payload)) as T
  } catch {
    return null
  }
}

async function signedJsonRequest(url: string, body: string, context: DeliveryContext, signingSecret: string | null | undefined): Promise<OutboundRequest> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': WEBHOOK_USER_AGENT,
    'Upvane-Event': String(context.event.type),
    'Upvane-Delivery': context.delivery.id,
  }
  if (signingSecret) headers[SIGNATURE_HEADER] = await signWebhookPayload(signingSecret, body)
  return { url, method: 'POST', headers, body }
}

async function checkWebhookHost(url: string, deps: DispatchDeps): Promise<{ ok: true } | { ok: false; reason: string }> {
  const base = validateWebhookUrl(url)
  if (!base.ok) return base
  if (!deps.resolve) return { ok: true }
  const resolved = await validateResolvedHost(base.hostname, deps.resolve)
  return resolved.ok ? { ok: true } : resolved
}

export async function prepareDelivery(context: DeliveryContext, deps: DispatchDeps): Promise<PreparedDelivery> {
  const message = buildAlertMessage(context.event, context.project, deps.links)
  const pageUrl = statusPageUrl(context.project, deps.links)

  // Status page subscribers
  if (context.subscriber) {
    const subscriber = context.subscriber
    if (!subscriber.confirmed) return { kind: 'skip', code: 'unconfirmed', reason: 'The subscriber has not confirmed.' }
    if (subscriber.type === 'email') {
      if (!subscriber.email) return { kind: 'skip', code: 'missing_target', reason: 'The subscriber has no email.' }
      const unsubscribe = await deps.unsubscribeUrl(context, null)
      const rendered = renderSubscriberUpdateEmail(message, {
        pageName: context.project.name,
        pageUrl,
        unsubscribeUrl: unsubscribe,
        brandColor: context.project.brand_color,
        logoUrl: context.project.logo_url,
      })
      return {
        kind: 'email',
        provider: 'resend',
        email: {
          to: subscriber.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        },
      }
    }
    const target = await readSecret<WebhookSecret & ChatSecret>(deps, subscriber.target_encrypted)
    const url = subscriber.type === 'slack' ? target?.webhook_url : target?.url
    if (!url) return { kind: 'skip', code: 'missing_target', reason: 'The subscriber target could not be read.' }
    if (subscriber.type === 'slack') {
      const valid = validateChatWebhookUrl('slack', url)
      if (!valid.ok) return { kind: 'skip', code: 'invalid_target', reason: valid.reason }
      const subscriberMessage = { ...message, dashboardUrl: message.statusPageUrl ?? pageUrl, dashboardLabel: 'View status page', statusPageUrl: null }
      return { kind: 'http', provider: 'slack', request: { url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildSlackPayload(subscriberMessage)) } }
    }
    const allowed = await checkWebhookHost(url, deps)
    if (!allowed.ok) return { kind: 'skip', code: 'invalid_target', reason: allowed.reason }
    const body = buildWebhookBody(context.event, message, context.project, { audience: 'subscribers', statusPageUrl: pageUrl })
    return { kind: 'http', provider: 'webhook', request: await signedJsonRequest(url, body, context, target?.signing_secret) }
  }

  // Team channels
  const channel = context.channel
  if (!channel) return { kind: 'skip', code: 'missing_channel', reason: 'The channel no longer exists.' }
  if (!channel.enabled) return { kind: 'skip', code: 'channel_disabled', reason: 'The channel is disabled.' }

  switch (channel.type) {
    case 'email': {
      const to = context.delivery.target
      if (!to || !to.includes('@')) return { kind: 'skip', code: 'missing_target', reason: 'No recipient.' }
      const rendered = renderTeamAlertEmail(message, { manageUrl: `${deps.links.appUrl.replace(/\/+$/, '')}/p/${context.project.id}/alerts` })
      return { kind: 'email', provider: 'resend', email: { to, subject: rendered.subject, html: rendered.html, text: rendered.text } }
    }
    case 'slack':
    case 'teams':
    case 'discord': {
      const secret = await readSecret<ChatSecret>(deps, channel.secret_encrypted)
      if (!secret?.webhook_url) return { kind: 'skip', code: 'missing_secret', reason: 'The webhook URL is missing. Edit the channel and paste it again.' }
      const valid = validateChatWebhookUrl(channel.type, secret.webhook_url)
      if (!valid.ok) return { kind: 'skip', code: 'invalid_target', reason: valid.reason }
      const payload = channel.type === 'slack' ? buildSlackPayload(message) : channel.type === 'teams' ? buildTeamsPayload(message) : buildDiscordPayload(message)
      return { kind: 'http', provider: channel.type, request: { url: secret.webhook_url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } }
    }
    case 'webhook': {
      const secret = await readSecret<WebhookSecret>(deps, channel.secret_encrypted)
      if (!secret?.url) return { kind: 'skip', code: 'missing_secret', reason: 'The webhook URL is missing. Edit the channel and paste it again.' }
      const allowed = await checkWebhookHost(secret.url, deps)
      if (!allowed.ok) return { kind: 'skip', code: 'invalid_target', reason: allowed.reason }
      const body = buildWebhookBody(context.event, message, context.project, { audience: 'team', statusPageUrl: pageUrl })
      return { kind: 'http', provider: 'webhook', request: await signedJsonRequest(secret.url, body, context, secret.signing_secret) }
    }
    case 'pagerduty': {
      if (!isPageable(String(context.event.type))) return { kind: 'skip', code: 'not_pageable', reason: 'PagerDuty only receives outages, incidents and tests.' }
      const secret = await readSecret<PagingSecret>(deps, channel.secret_encrypted)
      if (!secret?.routing_key) return { kind: 'skip', code: 'missing_secret', reason: 'The routing key is missing.' }
      return { kind: 'http', provider: 'pagerduty', request: buildPagerDutyRequest(message, secret.routing_key) }
    }
    case 'opsgenie': {
      if (!isPageable(String(context.event.type))) return { kind: 'skip', code: 'not_pageable', reason: 'Opsgenie only receives outages, incidents and tests.' }
      const secret = await readSecret<PagingSecret>(deps, channel.secret_encrypted)
      if (!secret?.api_key) return { kind: 'skip', code: 'missing_secret', reason: 'The API key is missing.' }
      const region = channel.config?.region === 'eu' ? 'eu' : 'us'
      return { kind: 'http', provider: 'opsgenie', request: buildOpsgenieRequest(message, secret.api_key, region) }
    }
    default:
      return { kind: 'skip', code: 'unsupported_channel', reason: `Unsupported channel ${String((channel as { type: string }).type)}.` }
  }
}

export type DeliveryOutcome = 'sent' | 'retryable' | 'failed'

/** 2xx sent; 408/409/425/429 and 5xx retry; other 4xx fail (the target rejected it and will keep doing so). */
export function classifyHttpStatus(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return 'retryable'
  return 'failed'
}

export const DELIVERY_BACKOFF_MINUTES = [1, 5, 30, 120, 360] as const
export const MAX_DELIVERY_ATTEMPTS = 5

export function nextRetryAt(attempts: number, now: Date = new Date(), retryAfterSeconds?: number | null): Date {
  const index = Math.max(0, Math.min(attempts - 1, DELIVERY_BACKOFF_MINUTES.length - 1))
  const backoffMs = DELIVERY_BACKOFF_MINUTES[index] * 60_000
  const retryAfterMs = retryAfterSeconds && retryAfterSeconds > 0 ? Math.min(retryAfterSeconds, 6 * 3600) * 1000 : 0
  return new Date(now.getTime() + Math.max(backoffMs, retryAfterMs))
}
