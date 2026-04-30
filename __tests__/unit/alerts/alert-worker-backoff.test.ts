import { describe, expect, it } from 'vitest'
import { nextRetryDate, retryDeferral } from '@/supabase/functions/alert-worker/backoff'

describe('alert worker retry backoff helpers', () => {
  const now = new Date('2026-04-30T17:00:00.000Z')

  it('defers queue messages with a future next_retry_at', () => {
    const result = retryDeferral('2026-04-30T17:05:01.000Z', now)

    expect(result).toEqual({ due: false, delaySeconds: 301 })
  })

  it('allows due retry messages to be processed', () => {
    expect(retryDeferral('2026-04-30T16:59:59.000Z', now)).toEqual({ due: true, delaySeconds: 0 })
    expect(retryDeferral(null, now)).toEqual({ due: true, delaySeconds: 0 })
  })

  it('computes bounded retry backoff dates by attempt number', () => {
    expect(nextRetryDate(1, now).toISOString()).toBe('2026-04-30T17:01:00.000Z')
    expect(nextRetryDate(4, now).toISOString()).toBe('2026-04-30T19:00:00.000Z')
    expect(nextRetryDate(99, now).toISOString()).toBe('2026-04-30T23:00:00.000Z')
  })
})
