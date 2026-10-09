// Pure helpers for the alert-worker Edge Function: queue messages, what to do with a loaded delivery, how to read a
// provider's answer (message id, error text, Retry-After) and the Resend / Mailpit email requests. No Deno globals.
import { classifyHttpStatus, MAX_DELIVERY_ATTEMPTS, nextRetryAt } from './dispatch.ts'
import type { EmailMessage, OutboundRequest } from './types.ts'

export const DEFAULT_EMAIL_FROM = 'Upvane <alerts@upvane.com>'
export const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

export type CompletionStatus = 'sent' | 'retryable' | 'failed' | 'suppressed'

/** Arguments for alert_worker_complete_delivery(). */
export interface DeliveryCompletion {
  status: CompletionStatus
  provider: string | null
  providerMessageId: string | null
  errorCode: string | null
  errorMessage: string | null
  nextRetryAt: string | null
}

/** PGMQ 'alert-deliveries' message, written by enqueue_alert_delivery_message(). */
export interface QueueMessage {
  deliveryId: string
  eventId: string | null
  projectId: string | null
  channel: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function parseQueueMessage(value: unknown): QueueMessage | null {
  if (!isRecord(value) || typeof value.deliveryId !== 'string' || !UUID.test(value.deliveryId)) return null
  return { deliveryId: value.deliveryId, eventId: optionalString(value.eventId), projectId: optionalString(value.projectId), channel: optionalString(value.channel) }
}

export const TERMINAL_DELIVERY_STATUSES: readonly string[] = ['sent', 'failed', 'suppressed']

export function isTerminalDeliveryStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_DELIVERY_STATUSES.includes(status)
}

/** Whole seconds until `value` (0 when it is unset, invalid or already past). */
export function secondsUntil(value: string | null | undefined, now: Date): number {
  if (!value) return 0
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.ceil((time - now.getTime()) / 1000))
}

const SUPPRESSED_SKIP_CODES = new Set(['channel_disabled', 'unconfirmed', 'not_pageable', 'missing_channel'])

/** prepareDelivery() skips: expected ones are suppressed; configuration problems fail so admins see them. */
export function skipStatus(code: string): 'suppressed' | 'failed' {
  return SUPPRESSED_SKIP_CODES.has(code) ? 'suppressed' : 'failed'
}

/** Retry-After in seconds: delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now: Date): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  if (!Number.isFinite(date)) return null
  return Math.max(0, Math.ceil((date - now.getTime()) / 1000))
}

/** Id of what the provider accepted: PagerDuty dedup_key, Opsgenie requestId, Resend id, Mailpit ID. */
export function providerMessageId(provider: string, bodyText: string): string | null {
  const body = parseJson(bodyText)
  if (!isRecord(body)) return null
  const key = { pagerduty: 'dedup_key', opsgenie: 'requestId', resend: 'id', mailpit: 'ID' }[provider]
  if (!key) return null
  const value = body[key]
  return typeof value === 'string' && value !== '' ? value.slice(0, 200) : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return null
}

/** Error code and text from a provider's error body: JSON message fields, or plain text such as Slack's `no_service`. */
export function providerError(bodyText: string): { code: string | null; message: string | null } {
  const body = parseJson(bodyText)
  if (isRecord(body)) {
    const nested = isRecord(body.error) ? body.error : null
    const message = firstString(body.message, nested?.message, body.error, body.error_description, body.detail, body.title)
    const extra = Array.isArray(body.errors) ? body.errors.filter((item): item is string => typeof item === 'string').join('; ') : ''
    const code = firstString(body.name, nested?.code, typeof body.code === 'string' ? body.code : null)
    const text = [message, extra].filter(Boolean).join(' ')
    return { code: code ? truncate(code.replace(/[^A-Za-z0-9_.-]+/g, '_'), 60) : null, message: text ? truncate(text, 300) : null }
  }
  const text = bodyText.trim()
  if (text === '' || text.startsWith('<')) return { code: null, message: null }
  return { code: null, message: truncate(text.split('\n')[0]!, 300) }
}

const PROVIDER_LABELS: Record<string, string> = {
  slack: 'Slack',
  teams: 'Microsoft Teams',
  discord: 'Discord',
  webhook: 'The webhook endpoint',
  pagerduty: 'PagerDuty',
  opsgenie: 'Opsgenie',
  resend: 'Resend',
  mailpit: 'Mailpit',
}

export function providerLabel(provider: string | null | undefined): string {
  return (provider && PROVIDER_LABELS[provider]) || 'The provider'
}

/** Retry later (backoff, honouring Retry-After) or fail for good once MAX_DELIVERY_ATTEMPTS is reached. */
export function retryOrFail(input: { attempts: number; now: Date; provider: string | null; code: string; message: string; retryAfterSeconds?: number | null }): DeliveryCompletion {
  if (input.attempts >= MAX_DELIVERY_ATTEMPTS) {
    return { status: 'failed', provider: input.provider, providerMessageId: null, errorCode: input.code, errorMessage: `${input.message} Gave up after ${input.attempts} attempts.`, nextRetryAt: null }
  }
  return {
    status: 'retryable',
    provider: input.provider,
    providerMessageId: null,
    errorCode: input.code,
    errorMessage: input.message,
    nextRetryAt: nextRetryAt(input.attempts, input.now, input.retryAfterSeconds ?? null).toISOString(),
  }
}

/** Outcome of an HTTP delivery (chat, webhooks, paging, email APIs). Redirects are never followed: they fail. */
export function httpDeliveryOutcome(input: { provider: string; status: number; bodyText: string; attempts: number; now: Date; retryAfterSeconds: number | null }): DeliveryCompletion {
  const outcome = classifyHttpStatus(input.status)
  if (outcome === 'sent') {
    return { status: 'sent', provider: input.provider, providerMessageId: providerMessageId(input.provider, input.bodyText), errorCode: null, errorMessage: null, nextRetryAt: null }
  }
  const label = providerLabel(input.provider)
  if (input.status >= 300 && input.status < 400) {
    return { status: 'failed', provider: input.provider, providerMessageId: null, errorCode: 'redirect', errorMessage: `${label} answered with a redirect (HTTP ${input.status}). Use the final URL in the channel settings.`, nextRetryAt: null }
  }
  const detail = providerError(input.bodyText)
  const code = detail.code ?? `http_${input.status}`
  const message = `${label} answered HTTP ${input.status}${detail.message ? `: ${detail.message}` : '.'}`
  if (outcome === 'retryable') return retryOrFail({ attempts: input.attempts, now: input.now, provider: input.provider, code, message, retryAfterSeconds: input.retryAfterSeconds })
  return { status: 'failed', provider: input.provider, providerMessageId: null, errorCode: code, errorMessage: message, nextRetryAt: null }
}

/** "Upvane <alerts@upvane.com>" → { email, name }. */
export function parseFromAddress(from: string): { email: string; name: string | null } {
  const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(from)
  if (match) return { email: match[2]!.trim(), name: match[1]!.replace(/^"|"$/g, '').trim() || null }
  return { email: from.trim(), name: null }
}

/** Resend: the delivery id is the Idempotency-Key, so a retried delivery is never sent twice. */
export function resendEmailRequest(email: EmailMessage, options: { apiKey: string; from: string; idempotencyKey: string }): OutboundRequest {
  return {
    url: RESEND_EMAILS_URL,
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey },
    body: JSON.stringify({ from: options.from, to: [email.to], subject: email.subject, html: email.html, text: email.text, ...(email.headers ? { headers: email.headers } : {}) }),
  }
}

/** Mailpit's send API (local development), same shape as lib/email.ts in the Next app. */
export function mailpitEmailRequest(email: EmailMessage, options: { baseUrl: string; from: string }): OutboundRequest {
  const sender = parseFromAddress(options.from)
  return {
    url: `${options.baseUrl.replace(/\/+$/, '')}/api/v1/send`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: { Email: sender.email, Name: sender.name ?? 'Upvane' },
      To: [{ Email: email.to }],
      Subject: email.subject,
      HTML: email.html,
      Text: email.text,
      ...(email.headers ? { Headers: email.headers } : {}),
    }),
  }
}
