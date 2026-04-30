import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { ALERT_CHANNEL_TYPE, type AlertChannelType, type AlertDeliveryQueueMessage, type AlertEventType, type AlertPayload, type AlertSourceType } from './types'

export const ALERT_DELIVERIES_QUEUE_NAME = 'alert-deliveries'
export const ALERT_WORKER_FUNCTION_NAME = 'alert-worker'

interface PublishAlertEventInput {
  projectId: string
  type: AlertEventType
  sourceType: AlertSourceType
  sourceId: string | null
  severity: string | null
  dedupeKey: string
  payload: AlertPayload
}

export interface PublishAlertEventResult {
  queued: boolean
  eventId: string | null
  deliveryCount: number
  messageCount: number
  workerInvoked: boolean
  error: string | null
}

interface EnqueueRpcResult {
  event_id?: unknown
  delivery_count?: unknown
  message_count?: unknown
}

export function isAlertDeliveryQueueMessage(value: unknown): value is AlertDeliveryQueueMessage {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Record<string, unknown>
  return typeof data.deliveryId === 'string'
    && typeof data.eventId === 'string'
    && typeof data.projectId === 'string'
    && isQueueChannel(data.channel)
}

export async function publishAlertEvent(input: PublishAlertEventInput): Promise<PublishAlertEventResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('enqueue_alert_event_and_dispatch', {
    p_project_id: input.projectId,
    p_type: input.type,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_severity: input.severity,
    p_dedupe_key: input.dedupeKey,
    p_payload: input.payload,
  })

  if (error) return { queued: false, eventId: null, deliveryCount: 0, messageCount: 0, workerInvoked: false, error: error.message }

  const result = normalizeRpcResult(data)
  const workerInvoked = result.messageCount > 0 ? await invokeAlertWorker() : false
  return { queued: true, ...result, workerInvoked, error: null }
}

export async function invokeAlertWorker(fetcher: typeof fetch = fetch): Promise<boolean> {
  const url = process.env.SUPABASE_URL
  const secret = process.env.ALERT_WORKER_SECRET ?? process.env.ALERTS_DISPATCHER_SECRET
  if (!url || !secret) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2_500)
  try {
    const response = await fetcher(`${url.replace(/\/$/, '')}/functions/v1/${ALERT_WORKER_FUNCTION_NAME}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'immediate' }),
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeRpcResult(value: unknown): Omit<PublishAlertEventResult, 'queued' | 'workerInvoked' | 'error'> {
  const data = Array.isArray(value) ? value[0] as EnqueueRpcResult | undefined : value as EnqueueRpcResult | undefined
  return {
    eventId: typeof data?.event_id === 'string' ? data.event_id : null,
    deliveryCount: typeof data?.delivery_count === 'number' ? data.delivery_count : 0,
    messageCount: typeof data?.message_count === 'number' ? data.message_count : 0,
  }
}

function isQueueChannel(value: unknown): value is AlertChannelType {
  return value === ALERT_CHANNEL_TYPE.EMAIL
}
