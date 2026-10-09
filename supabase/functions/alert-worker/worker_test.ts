import { assertEquals, assertStringIncludes } from '@std/assert'
import type { DeliveryContext } from '../_shared/alerts/types.ts'
import { bytesToBase64, encryptJson } from '../_shared/crypto.ts'
import { silentLogger } from '../_shared/edge/log.ts'
import { DatabaseError } from '../_shared/edge/supabase.ts'
import type { AdminClient } from '../_shared/edge/supabase.ts'
import { unsubscribeToken } from '../_shared/subscribers.ts'
import { handleWorkerRequest } from './handler.ts'
import { processMessage, runWorker, workerConfigDefaults } from './worker.ts'
import type { WorkerDeps } from './worker.ts'

const NOW = new Date('2026-10-09T12:00:00Z')
const KEY = bytesToBase64(new Uint8Array(32).fill(9))
const DELIVERY_ID = '0b6f4b0e-55a8-4a43-9b44-0c1a8d5d7e21'
const PROJECT = { id: '44444444-4444-4444-8444-444444444444', name: 'Quillbase status', slug: 'status', organization_slug: 'quill', brand_color: null, logo_url: null, custom_domain: null }

function context(overrides: Partial<Omit<DeliveryContext, 'delivery'>> & { delivery?: Partial<DeliveryContext['delivery']> } = {}): DeliveryContext {
  const { delivery, ...rest } = overrides
  return {
    delivery: { id: DELIVERY_ID, event_id: 'e1', channel_id: 'ch1', subscriber_id: null, target: 'oncall@upvane.test', target_type: 'email', status: 'pending', attempts: 0, next_retry_at: null, ...delivery },
    event: {
      id: 'e1',
      project_id: PROJECT.id,
      type: 'monitor_down',
      source_type: 'monitor',
      source_id: 'm1',
      severity: 'major_outage',
      dedupe_key: 'monitor:m1',
      payload: { reason: 'Payments API is down', monitor: { id: 'm1', name: 'Payments API', last_error: 'Status 503 is not 200-399.' } },
      audience: 'team',
      created_at: NOW.toISOString(),
    },
    channel: { id: 'ch1', type: 'email', name: 'Team email', enabled: true, config: {}, secret_encrypted: null },
    subscriber: null,
    project: PROJECT,
    ...rest,
  }
}

interface Call {
  fn: string
  args: Record<string, unknown>
}

function fakeDb(loaded: DeliveryContext | null, options: { attempts?: number | null; queue?: unknown[][] } = {}) {
  const calls: Call[] = []
  const queue = options.queue ?? []
  const db: AdminClient = {
    rpc: async <T>(fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args })
      switch (fn) {
        case 'alert_worker_load_delivery':
          return loaded as T
        case 'alert_worker_claim_delivery':
          return (options.attempts === undefined ? 1 : options.attempts) as T
        case 'recover_alert_delivery_queue':
          return [{ delivery_id: DELIVERY_ID, message_id: 9 }] as T
        case 'alert_worker_read_messages':
          return (queue.shift() ?? []) as T
        default:
          return null as T
      }
    },
    select: async <T>() => [] as T[],
  }
  return { db, calls }
}

interface Sent {
  url: string
  init: RequestInit
}

function deps(db: AdminClient, respond: (request: Sent) => Response | Promise<Response>, config: Partial<WorkerDeps['config']> = {}) {
  const sent: Sent[] = []
  const workerDeps: WorkerDeps = {
    db,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const request = { url: String(input), init: init ?? {} }
      sent.push(request)
      return await respond(request)
    }) as typeof fetch,
    resolve: async () => ['93.184.216.34'],
    config: workerConfigDefaults({ appUrl: 'https://app.upvane.dev', secretsKey: KEY, ...config }),
    now: () => NOW,
    clock: () => 0,
    log: silentLogger,
  }
  return { deps: workerDeps, sent }
}

const row = { msg_id: 7, message: { deliveryId: DELIVERY_ID, eventId: 'e1', projectId: PROJECT.id, channel: 'email' } }
const complete = (calls: Call[]) => calls.find((call) => call.fn === 'alert_worker_complete_delivery')?.args

Deno.test('team email goes to Resend with the delivery id as Idempotency-Key, then the message is deleted', async () => {
  const { db, calls } = fakeDb(context())
  const { deps: d, sent } = deps(db, () => Response.json({ id: 're_msg_1' }), { resendApiKey: 're_key', emailFrom: 'Upvane <alerts@upvane.com>' })
  assertEquals(await processMessage(row, d), 'sent')
  assertEquals(sent[0]!.url, 'https://api.resend.com/emails')
  assertEquals((sent[0]!.init.headers as Record<string, string>)['Idempotency-Key'], DELIVERY_ID)
  assertEquals(sent[0]!.init.redirect, 'manual')
  const body = JSON.parse(String(sent[0]!.init.body))
  assertEquals([body.to, body.subject], [['oncall@upvane.test'], '[Quillbase status] Payments API is down'])
  assertEquals(complete(calls), { p_delivery_id: DELIVERY_ID, p_status: 'sent', p_provider: 'resend', p_provider_message_id: 're_msg_1', p_error_code: null, p_error_message: null, p_next_retry_at: null })
  assertEquals(calls.at(-1), { fn: 'alert_worker_delete_message', args: { p_msg_id: 7 } })
})

Deno.test('Mailpit is used locally when Resend is not configured; neither fails the delivery', async () => {
  const local = fakeDb(context())
  const mailpit = deps(local.db, () => Response.json({ ID: 'mp1' }), { mailpitUrl: 'http://127.0.0.1:54324' })
  assertEquals(await processMessage(row, mailpit.deps), 'sent')
  assertEquals(mailpit.sent[0]!.url, 'http://127.0.0.1:54324/api/v1/send')
  assertEquals(complete(local.calls)?.p_provider_message_id, 'mp1')

  const none = fakeDb(context())
  assertEquals(await processMessage(row, deps(none.db, () => new Response()).deps), 'failed')
  assertEquals(complete(none.calls)?.p_error_code, 'email_not_configured')
})

Deno.test('subscriber emails carry a working unsubscribe link', async () => {
  const subscriber = context({
    channel: null,
    delivery: { channel_id: null, subscriber_id: 's1', target_type: 'subscriber_email', target: 'reader@example.com' },
    subscriber: { id: 's1', type: 'email', email: 'reader@example.com', target_encrypted: null, confirmed: true },
    event: { ...context().event, type: 'incident_created', audience: 'subscribers', payload: { incident: { id: 'i1', title: 'Failed payments', status: 'investigating', impact: 'major' } } },
  })
  const { db } = fakeDb(subscriber)
  const { deps: d, sent } = deps(db, () => Response.json({ ID: 'mp2' }), { mailpitUrl: 'http://mailpit' })
  assertEquals(await processMessage(row, d), 'sent')
  const token = await unsubscribeToken(KEY, PROJECT.id, 'email:reader@example.com')
  const body = JSON.parse(String(sent[0]!.init.body))
  assertEquals(body.Headers['List-Unsubscribe'], `<https://app.upvane.dev/subscriptions/unsubscribe?token=${encodeURIComponent(token)}>`)
})

Deno.test('webhooks are signed; 429 with Retry-After is retried later and the message deferred', async () => {
  const secret_encrypted = await encryptJson({ url: 'https://hooks.example.com/upvane', signing_secret: 'whsec' }, KEY)
  const { db, calls } = fakeDb(context({ channel: { id: 'ch1', type: 'webhook', name: 'Ops', enabled: true, config: {}, secret_encrypted } }), { attempts: 2 })
  const { deps: d, sent } = deps(db, () => new Response('slow down', { status: 429, headers: { 'Retry-After': '900' } }))
  assertEquals(await processMessage(row, d), 'retryable')
  assertStringIncludes((sent[0]!.init.headers as Record<string, string>)['Upvane-Signature'] ?? '', 'v1=')
  assertEquals(complete(calls), {
    p_delivery_id: DELIVERY_ID,
    p_status: 'retryable',
    p_provider: 'webhook',
    p_provider_message_id: null,
    p_error_code: 'http_429',
    p_error_message: 'The webhook endpoint answered HTTP 429: slow down',
    p_next_retry_at: '2026-10-09T12:15:00.000Z',
  })
  assertEquals(calls.at(-1), { fn: 'alert_worker_defer_message', args: { p_msg_id: 7, p_delay_seconds: 900 } })
})

Deno.test('PagerDuty keeps the dedup key; network errors on the last attempt fail', async () => {
  const secret_encrypted = await encryptJson({ routing_key: 'R'.repeat(32) }, KEY)
  const pd = context({ channel: { id: 'ch1', type: 'pagerduty', name: 'On-call', enabled: true, config: {}, secret_encrypted } })
  const ok = fakeDb(pd)
  assertEquals(await processMessage(row, deps(ok.db, () => Response.json({ status: 'success', dedup_key: 'upvane:p:monitor:m1' }, { status: 202 })).deps), 'sent')
  assertEquals([complete(ok.calls)?.p_provider, complete(ok.calls)?.p_provider_message_id], ['pagerduty', 'upvane:p:monitor:m1'])

  const down = fakeDb(pd, { attempts: 5 })
  const result = await processMessage(row, deps(down.db, () => Promise.reject(new TypeError('fetch failed', { cause: new Error('tcp connect error: Connection refused (os error 111)') }))).deps)
  assertEquals(result, 'failed')
  assertEquals(complete(down.calls)?.p_error_code, 'network_error')
  assertEquals(complete(down.calls)?.p_error_message, 'Could not reach PagerDuty. Connection refused. Gave up after 5 attempts.')
})

Deno.test('skips: disabled channels are suppressed, configuration problems fail, private webhooks are refused', async () => {
  const disabled = fakeDb(context({ channel: { id: 'ch1', type: 'slack', name: 'Slack', enabled: false, config: {}, secret_encrypted: null } }))
  assertEquals(await processMessage(row, deps(disabled.db, () => new Response()).deps), 'suppressed')
  assertEquals(complete(disabled.calls)?.p_error_code, 'channel_disabled')

  const noSecret = fakeDb(context({ channel: { id: 'ch1', type: 'slack', name: 'Slack', enabled: true, config: {}, secret_encrypted: null } }))
  assertEquals(await processMessage(row, deps(noSecret.db, () => new Response()).deps), 'failed')
  assertEquals(complete(noSecret.calls)?.p_error_code, 'missing_secret')

  const secret_encrypted = await encryptJson({ url: 'https://hooks.example.com/x' }, KEY)
  const internal = fakeDb(context({ channel: { id: 'ch1', type: 'webhook', name: 'Ops', enabled: true, config: {}, secret_encrypted } }))
  const internalDeps = deps(internal.db, () => new Response())
  internalDeps.deps.resolve = async () => ['10.0.0.8']
  assertEquals(await processMessage(row, internalDeps.deps), 'failed')
  assertEquals([complete(internal.calls)?.p_error_code, internalDeps.sent.length], ['invalid_target', 0])

  const noKey = fakeDb(context({ channel: { id: 'ch1', type: 'webhook', name: 'Ops', enabled: true, config: {}, secret_encrypted } }))
  assertEquals(await processMessage(row, deps(noKey.db, () => new Response(), { secretsKey: undefined }).deps), 'retryable')
  assertEquals(complete(noKey.calls)?.p_error_code, 'secrets_key_missing')
})

Deno.test('queue bookkeeping: missing, terminal, not yet due, claimed elsewhere, invalid', async () => {
  const missing = fakeDb(null)
  assertEquals(await processMessage(row, deps(missing.db, () => new Response()).deps), 'deleted')
  const terminal = fakeDb(context({ delivery: { status: 'sent' } }))
  assertEquals(await processMessage(row, deps(terminal.db, () => new Response()).deps), 'deleted')
  const later = fakeDb(context({ delivery: { status: 'retryable', next_retry_at: '2026-10-09T12:05:00Z' } }))
  assertEquals(await processMessage(row, deps(later.db, () => new Response()).deps), 'deferred')
  assertEquals(later.calls.at(-1), { fn: 'alert_worker_defer_message', args: { p_msg_id: 7, p_delay_seconds: 300 } })
  const elsewhere = fakeDb(context(), { attempts: null })
  assertEquals(await processMessage(row, deps(elsewhere.db, () => new Response()).deps), 'skipped')
  assertEquals(elsewhere.calls.some((call) => call.fn.includes('message')), false)
  const invalid = fakeDb(context())
  assertEquals(await processMessage({ msg_id: 8, message: { hello: 1 } }, deps(invalid.db, () => new Response()).deps), 'deleted')
})

Deno.test('runWorker recovers, drains batches and never processes a message twice in one run', async () => {
  const { db, calls } = fakeDb(context(), { queue: [[row], [row], []] })
  const summary = await runWorker(deps(db, () => Response.json({ ID: 'mp' }), { mailpitUrl: 'http://mailpit' }).deps)
  assertEquals(calls[0], { fn: 'recover_alert_delivery_queue', args: { p_limit: 20 } })
  assertEquals(calls[1], { fn: 'alert_worker_read_messages', args: { p_batch_size: 10, p_visibility_timeout: 60 } })
  assertEquals([summary.recovered, summary.read, summary.outcomes.sent], [1, 1, 1])
  assertEquals(calls.filter((call) => call.fn === 'finalize_alert_event').map((call) => call.args), [{ p_event_id: 'e1' }])

  const broken: AdminClient = { rpc: () => Promise.reject(new DatabaseError('rpc: down', 'network_error', 0)), select: async <T>() => [] as T[] }
  const failure = await runWorker(deps(broken, () => new Response()).deps)
  assertEquals(failure.error, 'Could not read the alert queue.')
})

Deno.test('handler accepts ALERT_WORKER_SECRET and the legacy ALERTS_DISPATCHER_SECRET', async () => {
  Deno.env.set('ALERTS_DISPATCHER_SECRET', 'legacy-secret')
  Deno.env.set('PUBLIC_APP_URL', 'https://app.upvane.dev')
  try {
    const { db } = fakeDb(null, { queue: [[]] })
    const call = (token: string) => new Request('http://localhost/alert-worker', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{"source":"cron"}' })
    assertEquals((await handleWorkerRequest(call('nope'), { db })).status, 401)
    const ok = await handleWorkerRequest(call('legacy-secret'), { db })
    assertEquals([ok.status, (await ok.json()).read], [200, 0])
  } finally {
    Deno.env.delete('ALERTS_DISPATCHER_SECRET')
    Deno.env.delete('PUBLIC_APP_URL')
  }
})
