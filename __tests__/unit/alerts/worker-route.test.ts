import { beforeEach, describe, expect, it, vi } from 'vitest'

const processPendingAlertsMock = vi.fn()

vi.mock('@/lib/alerts/processor', () => ({
  processPendingAlerts: processPendingAlertsMock,
}))

describe('alerts worker route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    processPendingAlertsMock.mockResolvedValue({ processedEvents: 0, sent: 0, retryable: 0, failed: 0, suppressed: 0, errors: [] })
    process.env.ALERT_WORKER_SECRET = 'worker-secret'
  })

  it('requires the worker bearer secret', async () => {
    const { POST } = await import('@/app/api/alerts/worker/route')

    const response = await POST(new Request('https://upvane.test/api/alerts/worker', { method: 'POST' }))

    expect(response.status).toBe(401)
    expect(processPendingAlertsMock).not.toHaveBeenCalled()
  })

  it('processes pending alerts with the valid worker bearer secret', async () => {
    const { POST } = await import('@/app/api/alerts/worker/route')

    const response = await POST(new Request('https://upvane.test/api/alerts/worker', {
      method: 'POST',
      headers: { authorization: 'Bearer worker-secret' },
    }))

    expect(response.status).toBe(200)
    expect(processPendingAlertsMock).toHaveBeenCalledOnce()
  })
})
