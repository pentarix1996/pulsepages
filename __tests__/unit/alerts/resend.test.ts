import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendResendEmail } from '@/lib/alerts/adapters/resend'

describe('resend adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('maps 429 responses as retryable without sending real email', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('ALERTS_EMAIL_FROM', 'Upvane <alerts@upvane.com>')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'rate_limit', message: 'Slow down' }), { status: 429 })))

    const result = await sendResendEmail({ to: 'ops@upvane.com', subject: 'Test', html: '<p>Test</p>', text: 'Test' }, 'key-1')

    expect(result.status).toBe('retryable')
    expect(result.errorCode).toBe('rate_limit')
  })
})
