import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALERT_CHANNEL_TYPE, ALERT_EVENT_TYPE, ALERT_SOURCE_TYPE, type AlertPayload } from '@/lib/alerts/types'
import { isAlertDeliveryQueueMessage, invokeAlertWorker, publishAlertEvent } from '@/lib/alerts/queue'

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

const payload: AlertPayload = {
  project_id: 'project-1',
  project_name: 'Upvane',
  event_type: ALERT_EVENT_TYPE.TEST,
  status: 'operational',
  severity: 'test',
  reason: 'Test alert',
  occurred_at: new Date().toISOString(),
  dashboard_url: null,
  status_page_url: null,
  component: null,
  incident: null,
  monitor: null,
}

describe('alert queue publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    delete process.env.SUPABASE_URL
    delete process.env.ALERT_WORKER_SECRET
  })

  it('accepts only minimal delivery queue messages', () => {
    expect(isAlertDeliveryQueueMessage({ deliveryId: 'delivery-1', eventId: 'event-1', projectId: 'project-1', channel: ALERT_CHANNEL_TYPE.EMAIL })).toBe(true)
    expect(isAlertDeliveryQueueMessage({ deliveryId: 'delivery-1', eventId: 'event-1', projectId: 'project-1', channel: 'slack', secret: 'nope' })).toBe(false)
  })

  it('publishes through the queue RPC and invokes the Edge worker best-effort', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.ALERT_WORKER_SECRET = 'worker-secret'
    const rpc = vi.fn(async () => ({ data: { event_id: 'event-1', delivery_count: 1, message_count: 1 }, error: null }))
    createAdminClientMock.mockReturnValue({ rpc })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishAlertEvent({
      projectId: 'project-1',
      type: ALERT_EVENT_TYPE.TEST,
      sourceType: ALERT_SOURCE_TYPE.TEST,
      sourceId: null,
      severity: 'test',
      dedupeKey: 'project-1:test',
      payload,
    })

    expect(result.queued).toBe(true)
    expect(result.messageCount).toBe(1)
    expect(result.workerInvoked).toBe(true)
    expect(rpc).toHaveBeenCalledWith('enqueue_alert_event_and_dispatch', expect.objectContaining({ p_project_id: 'project-1' }))
    expect(fetchMock).toHaveBeenCalledWith('https://example.supabase.co/functions/v1/alert-worker', expect.objectContaining({ method: 'POST' }))
  })

  it('does not fail publishing when worker invocation fails', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.ALERT_WORKER_SECRET = 'worker-secret'
    const fetchMock = vi.fn(async () => { throw new Error('offline') })

    await expect(invokeAlertWorker(fetchMock)).resolves.toBe(false)
  })

  it('persists no-enabled-channel events without invoking the worker', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.ALERT_WORKER_SECRET = 'worker-secret'
    const rpc = vi.fn(async () => ({ data: { event_id: 'event-1', delivery_count: 0, message_count: 0 }, error: null }))
    createAdminClientMock.mockReturnValue({ rpc })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishAlertEvent({
      projectId: 'project-1',
      type: ALERT_EVENT_TYPE.TEST,
      sourceType: ALERT_SOURCE_TYPE.TEST,
      sourceId: null,
      severity: 'test',
      dedupeKey: 'project-1:test',
      payload,
    })

    expect(result).toEqual(expect.objectContaining({ queued: true, eventId: 'event-1', deliveryCount: 0, messageCount: 0, workerInvoked: false }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
