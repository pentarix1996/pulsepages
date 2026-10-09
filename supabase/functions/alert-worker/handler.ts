// alert-worker: POST, Authorization: Bearer <ALERT_WORKER_SECRET> (legacy ALERTS_DISPATCHER_SECRET also accepted).
// Woken by enqueue_alert_event_and_dispatch() through pg_net and by pg_cron every minute. Recovers stuck deliveries,
// then drains the 'alert-deliveries' queue for up to ~50 s and answers a summary.
import { DEFAULT_EMAIL_FROM } from '../_shared/alerts/delivery.ts'
import { hasBearerSecret } from '../_shared/edge/auth.ts'
import { addressResolver, systemRecordLookup } from '../_shared/edge/dns.ts'
import { publicAppUrl, readEnv } from '../_shared/edge/env.ts'
import { errorResponse, jsonResponse } from '../_shared/edge/http.ts'
import { log } from '../_shared/edge/log.ts'
import { adminClientFromEnv } from '../_shared/edge/supabase.ts'
import type { AdminClient } from '../_shared/edge/supabase.ts'
import { runWorker } from './worker.ts'
import type { WorkerDeps, WorkerOptions } from './worker.ts'

export interface WorkerOverrides {
  db?: AdminClient
  fetch?: typeof fetch
  resolve?: WorkerDeps['resolve']
  options?: WorkerOptions
}

export async function handleWorkerRequest(request: Request, overrides: WorkerOverrides = {}): Promise<Response> {
  if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Send a POST request.', { Allow: 'POST' })

  const secrets = [readEnv('ALERT_WORKER_SECRET'), readEnv('ALERTS_DISPATCHER_SECRET')]
  if (!secrets.some(Boolean)) {
    log('error', 'alert_worker_not_configured', { reason: 'ALERT_WORKER_SECRET is not set.' })
    return errorResponse(503, 'unavailable', 'The alert worker is not configured.')
  }
  if (!(await hasBearerSecret(request, secrets))) return errorResponse(401, 'unauthorized', 'Unauthorized.')
  await request.body?.cancel().catch(() => undefined)

  const db = overrides.db ?? adminClientFromEnv(overrides.fetch)
  const appUrl = publicAppUrl()
  if (!db || !appUrl) {
    log('error', 'alert_worker_not_configured', { reason: 'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and PUBLIC_APP_URL are required.' })
    return errorResponse(503, 'unavailable', 'The alert worker is not configured.')
  }
  const secretsKey = readEnv('UPVANE_SECRETS_KEY')
  if (!secretsKey) log('warn', 'alert_worker_without_secrets_key', { reason: 'Channels with secrets and subscriber notifications cannot be delivered.' })

  const lookup = systemRecordLookup()
  const deps: WorkerDeps = {
    db,
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    resolve: overrides.resolve ?? (lookup ? addressResolver(lookup) : undefined),
    config: {
      appUrl,
      secretsKey,
      resendApiKey: readEnv('RESEND_API_KEY'),
      emailFrom: readEnv('ALERTS_EMAIL_FROM') ?? DEFAULT_EMAIL_FROM,
      mailpitUrl: readEnv('LOCAL_MAILPIT_URL'),
    },
    now: () => new Date(),
    clock: () => performance.now(),
    log,
  }
  const summary = await runWorker(deps, overrides.options)
  return jsonResponse(summary, summary.error && summary.read === 0 ? 500 : 200)
}
