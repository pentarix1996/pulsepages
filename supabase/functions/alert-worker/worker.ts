// alert-worker core: reads the PGMQ 'alert-deliveries' queue, prepares each delivery with _shared/alerts/dispatch.ts,
// sends it (Resend / Mailpit / HTTP) and records the outcome with alert_worker_complete_delivery().
// Dependencies are injected so tests run without network or database.
import { prepareDelivery } from '../_shared/alerts/dispatch.ts'
import type { DispatchDeps, PreparedDelivery } from '../_shared/alerts/dispatch.ts'
import {
  DEFAULT_EMAIL_FROM,
  httpDeliveryOutcome,
  isTerminalDeliveryStatus,
  mailpitEmailRequest,
  parseQueueMessage,
  parseRetryAfter,
  providerLabel,
  resendEmailRequest,
  retryOrFail,
  secondsUntil,
  skipStatus,
} from '../_shared/alerts/delivery.ts'
import type { DeliveryCompletion } from '../_shared/alerts/delivery.ts'
import type { DeliveryContext, EmailMessage, OutboundRequest } from '../_shared/alerts/types.ts'
import { decryptSecret } from '../_shared/crypto.ts'
import { drainWithBudget } from '../_shared/monitoring/runner.ts'
import { describeNetworkError, formatDuration, isTimeoutError } from '../_shared/monitoring/probe.ts'
import type { DnsResolver } from '../_shared/monitoring/ssrf.ts'
import { subscriberKey, unsubscribeToken, unsubscribeUrl } from '../_shared/subscribers.ts'
import { readTextLimited, withTimeout } from '../_shared/edge/http.ts'
import { errorMessage } from '../_shared/edge/log.ts'
import type { Logger } from '../_shared/edge/log.ts'
import type { AdminClient } from '../_shared/edge/supabase.ts'

export const HTTP_DELIVERY_TIMEOUT_MS = 10_000
const MAX_PROVIDER_BODY_BYTES = 64 * 1024

export interface WorkerConfig {
  appUrl: string
  secretsKey: string | undefined
  resendApiKey: string | undefined
  emailFrom: string
  mailpitUrl: string | undefined
}

export interface WorkerDeps {
  db: AdminClient
  fetch: typeof fetch
  /** A + AAAA resolver for the SSRF re-check of generic webhooks (undefined: static checks only). */
  resolve: DnsResolver | undefined
  config: WorkerConfig
  now(): Date
  clock(): number
  log: Logger
}

export type MessageOutcome = 'sent' | 'retryable' | 'failed' | 'suppressed' | 'deleted' | 'deferred' | 'skipped' | 'error'

interface QueueRow {
  msg_id: number
  message: unknown
}

async function deleteMessage(deps: WorkerDeps, msgId: number): Promise<void> {
  await deps.db.rpc('alert_worker_delete_message', { p_msg_id: msgId })
}

async function deferMessage(deps: WorkerDeps, msgId: number, seconds: number): Promise<void> {
  await deps.db.rpc('alert_worker_defer_message', { p_msg_id: msgId, p_delay_seconds: Math.max(1, Math.ceil(seconds)) })
}

/** DispatchDeps for prepareDelivery(): links, secret decryption, unsubscribe links and the DNS resolver. */
export function dispatchDeps(deps: WorkerDeps): DispatchDeps {
  const key = deps.config.secretsKey
  const decrypt = (payload: string) => {
    if (!key) return Promise.reject(new Error('UPVANE_SECRETS_KEY is not set.'))
    return decryptSecret(payload, key)
  }
  return {
    links: { appUrl: deps.config.appUrl },
    decrypt,
    unsubscribeUrl: async (context: DeliveryContext, targetUrl: string | null) => {
      if (!key) throw new Error('UPVANE_SECRETS_KEY is not set.')
      const subscriber = context.subscriber
      if (!subscriber) throw new Error('The delivery has no subscriber.')
      let url = targetUrl
      if (subscriber.type !== 'email' && !url && subscriber.target_encrypted) {
        const target = JSON.parse(await decrypt(subscriber.target_encrypted)) as { url?: string; webhook_url?: string }
        url = (subscriber.type === 'slack' ? target.webhook_url : target.url) ?? null
      }
      const token = await unsubscribeToken(key, context.project.id, subscriberKey({ type: subscriber.type, email: subscriber.email, targetUrl: url }))
      return unsubscribeUrl(deps.config.appUrl, token)
    },
    resolve: deps.resolve,
  }
}

/** Deliveries that cannot be prepared without UPVANE_SECRETS_KEY (channel secrets, subscriber targets, unsubscribe links). */
function needsSecretsKey(context: DeliveryContext): boolean {
  if (context.subscriber) return true
  return Boolean(context.channel && context.channel.type !== 'email' && context.channel.secret_encrypted)
}

async function sendHttp(deps: WorkerDeps, provider: string, request: OutboundRequest, attempts: number): Promise<DeliveryCompletion> {
  try {
    return await withTimeout(HTTP_DELIVERY_TIMEOUT_MS, async (signal) => {
      const response = await deps.fetch(request.url, { method: request.method, headers: request.headers, body: request.body, redirect: 'manual', signal })
      const body = await readTextLimited(response, MAX_PROVIDER_BODY_BYTES).catch(() => ({ text: '' }))
      const now = deps.now()
      return httpDeliveryOutcome({ provider, status: response.status, bodyText: body.text, attempts, now, retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after'), now) })
    })
  } catch (error) {
    const label = providerLabel(provider)
    const timedOut = isTimeoutError(error)
    const message = timedOut ? `${label} did not answer within ${formatDuration(HTTP_DELIVERY_TIMEOUT_MS)}.` : `Could not reach ${label.replace(/^The /, 'the ')}. ${describeNetworkError(error)}`
    return retryOrFail({ attempts, now: deps.now(), provider, code: timedOut ? 'timeout' : 'network_error', message })
  }
}

async function sendEmail(deps: WorkerDeps, email: EmailMessage, deliveryId: string, attempts: number): Promise<DeliveryCompletion> {
  const { resendApiKey, mailpitUrl, emailFrom } = deps.config
  if (resendApiKey) return sendHttp(deps, 'resend', resendEmailRequest(email, { apiKey: resendApiKey, from: emailFrom, idempotencyKey: deliveryId }), attempts)
  if (mailpitUrl) return sendHttp(deps, 'mailpit', mailpitEmailRequest(email, { baseUrl: mailpitUrl, from: emailFrom }), attempts)
  return {
    status: 'failed',
    provider: null,
    providerMessageId: null,
    errorCode: 'email_not_configured',
    errorMessage: 'Email is not configured: set RESEND_API_KEY (or LOCAL_MAILPIT_URL in local development).',
    nextRetryAt: null,
  }
}

/** Decides and performs one delivery that this worker has claimed (`attempts` already includes this attempt). */
export async function deliver(context: DeliveryContext, attempts: number, deps: WorkerDeps): Promise<DeliveryCompletion> {
  if (!deps.config.secretsKey && needsSecretsKey(context)) {
    return retryOrFail({ attempts, now: deps.now(), provider: null, code: 'secrets_key_missing', message: 'The alert worker cannot read channel secrets: UPVANE_SECRETS_KEY is not set.' })
  }
  let prepared: PreparedDelivery
  try {
    prepared = await prepareDelivery(context, dispatchDeps(deps))
  } catch (error) {
    deps.log('error', 'alert_prepare_failed', { delivery_id: context.delivery.id, error: errorMessage(error) })
    return retryOrFail({ attempts, now: deps.now(), provider: null, code: 'prepare_failed', message: 'The alert could not be prepared.' })
  }
  if (prepared.kind === 'skip') {
    return { status: skipStatus(prepared.code), provider: null, providerMessageId: null, errorCode: prepared.code, errorMessage: prepared.reason, nextRetryAt: null }
  }
  if (prepared.kind === 'email') return sendEmail(deps, prepared.email, context.delivery.id, attempts)
  return sendHttp(deps, prepared.provider, prepared.request, attempts)
}

/**
 * One queue message: load → (delete | defer | claim → deliver → complete → delete | defer).
 * `completedEvents` collects the events whose deliveries this worker completed (see runWorker).
 */
export async function processMessage(row: QueueRow, deps: WorkerDeps, completedEvents?: Set<string>): Promise<MessageOutcome> {
  const started = deps.clock()
  const msgId = Number(row.msg_id)
  const message = parseQueueMessage(row.message)
  if (!message) {
    deps.log('warn', 'alert_message_invalid', { msg_id: msgId })
    await deleteMessage(deps, msgId)
    return 'deleted'
  }

  const context = await deps.db.rpc<DeliveryContext | null>('alert_worker_load_delivery', { p_delivery_id: message.deliveryId })
  if (!context || !context.delivery) {
    await deleteMessage(deps, msgId)
    return 'deleted'
  }
  if (isTerminalDeliveryStatus(context.delivery.status)) {
    await deleteMessage(deps, msgId)
    return 'deleted'
  }
  const wait = secondsUntil(context.delivery.next_retry_at, deps.now())
  if (wait > 0) {
    await deferMessage(deps, msgId, wait)
    return 'deferred'
  }

  const attempts = await deps.db.rpc<number | null>('alert_worker_claim_delivery', { p_delivery_id: context.delivery.id })
  // Null: another worker holds it (processing) or it changed since it was loaded. Its message comes back later.
  if (attempts === null || attempts === undefined) return 'skipped'

  const completion = await deliver(context, Number(attempts), deps)
  await deps.db.rpc('alert_worker_complete_delivery', {
    p_delivery_id: context.delivery.id,
    p_status: completion.status,
    p_provider: completion.provider,
    p_provider_message_id: completion.providerMessageId,
    p_error_code: completion.errorCode,
    p_error_message: completion.errorMessage,
    p_next_retry_at: completion.nextRetryAt,
  })
  if (context.event?.id) completedEvents?.add(context.event.id)
  if (completion.status === 'retryable') await deferMessage(deps, msgId, secondsUntil(completion.nextRetryAt, deps.now()))
  else await deleteMessage(deps, msgId)

  deps.log(completion.status === 'failed' ? 'warn' : 'info', 'alert_delivery', {
    delivery_id: context.delivery.id,
    event_id: context.event?.id ?? null,
    event_type: context.event?.type ?? null,
    target_type: context.delivery.target_type,
    attempt: Number(attempts),
    status: completion.status,
    provider: completion.provider,
    provider_message_id: completion.providerMessageId,
    error_code: completion.errorCode,
    ...(completion.status !== 'sent' && completion.errorMessage ? { error: completion.errorMessage } : {}),
    duration_ms: Math.round(deps.clock() - started),
  })
  return completion.status
}

export interface WorkerOptions {
  recoverLimit: number
  batchSize: number
  visibilityTimeoutSeconds: number
  concurrency: number
  budgetMs: number
}

export const WORKER_DEFAULTS: WorkerOptions = { recoverLimit: 20, batchSize: 10, visibilityTimeoutSeconds: 60, concurrency: 5, budgetMs: 50_000 }

export interface WorkerSummary {
  recovered: number
  read: number
  outcomes: Record<MessageOutcome, number>
  budget_exhausted: boolean
  duration_ms: number
  error?: string
}

export async function runWorker(deps: WorkerDeps, options: WorkerOptions = WORKER_DEFAULTS): Promise<WorkerSummary> {
  const started = deps.clock()
  const outcomes: Record<MessageOutcome, number> = { sent: 0, retryable: 0, failed: 0, suppressed: 0, deleted: 0, deferred: 0, skipped: 0, error: 0 }
  let recovered = 0
  try {
    const rows = await deps.db.rpc<unknown[]>('recover_alert_delivery_queue', { p_limit: options.recoverLimit })
    recovered = Array.isArray(rows) ? rows.length : 0
  } catch (error) {
    // Recovery is a safety net; reading the queue still makes progress without it.
    deps.log('warn', 'alert_recover_failed', { error: errorMessage(error) })
  }

  const seen = new Set<number>()
  const completedEvents = new Set<string>()
  const stats = await drainWithBudget(
    async () => {
      const rows = await deps.db.rpc<QueueRow[]>('alert_worker_read_messages', { p_batch_size: options.batchSize, p_visibility_timeout: options.visibilityTimeoutSeconds })
      // A message read twice in one run (its visibility timeout expired) means it is not progressing: stop there.
      const fresh = (Array.isArray(rows) ? rows : []).filter((row) => !seen.has(Number(row.msg_id)))
      for (const row of fresh) seen.add(Number(row.msg_id))
      return fresh
    },
    async (row: QueueRow) => {
      try {
        outcomes[await processMessage(row, deps, completedEvents)] += 1
      } catch (error) {
        // Database errors leave the message in the queue: it becomes visible again after the visibility timeout.
        outcomes.error += 1
        deps.log('error', 'alert_message_failed', { msg_id: Number(row.msg_id), error: errorMessage(error) })
      }
    },
    { concurrency: options.concurrency, budgetMs: options.budgetMs, now: () => deps.clock() },
  )

  // Deliveries of one event completed in parallel can each see the other still processing inside
  // finalize_alert_event() (read committed), leaving the event pending. Finalizing again is idempotent.
  for (const eventId of completedEvents) {
    await deps.db.rpc('finalize_alert_event', { p_event_id: eventId }).catch((error) => deps.log('warn', 'alert_finalize_failed', { event_id: eventId, error: errorMessage(error) }))
  }

  const summary: WorkerSummary = { recovered, read: stats.claimed, outcomes, budget_exhausted: stats.budgetExhausted, duration_ms: Math.round(deps.clock() - started) }
  if (stats.claimError) {
    summary.error = 'Could not read the alert queue.'
    deps.log('error', 'alert_queue_read_failed', { error: errorMessage(stats.claimError) })
  }
  deps.log(summary.error ? 'warn' : 'info', 'alert_worker_summary', { ...summary })
  return summary
}

export function workerConfigDefaults(partial: Partial<WorkerConfig> & { appUrl: string }): WorkerConfig {
  return { secretsKey: undefined, resendApiKey: undefined, emailFrom: DEFAULT_EMAIL_FROM, mailpitUrl: undefined, ...partial }
}
