// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { systemTestContext } from './fake-supabase'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(), createActorClient: vi.fn() }))

const { failureMessageFrom, heartbeatUrl, recordHeartbeat, tokenBucket } = await import('@/lib/domain/heartbeats')

describe('recordHeartbeat', () => {
  it('records success and failure pings through record_heartbeat with the admin client', async () => {
    const { ctx, calls } = systemTestContext((call) => ({ data: { id: 'm1', state: (call.payload as { p_success: boolean }).p_success ? 'up' : 'down' }, error: null }))
    await expect(recordHeartbeat(ctx, 'demo-heartbeat-token-nightly-invoices', { success: true })).resolves.toEqual({ state: 'up' })
    await expect(recordHeartbeat(ctx, 'demo-heartbeat-token-nightly-invoices', { success: false, message: '  disk full  ' })).resolves.toEqual({ state: 'down' })
    expect(calls.map((call) => call.payload)).toEqual([
      { p_token: 'demo-heartbeat-token-nightly-invoices', p_success: true, p_message: null },
      { p_token: 'demo-heartbeat-token-nightly-invoices', p_success: false, p_message: 'disk full' },
    ])
    expect(calls.every((call) => call.client === 'admin' && call.table === 'rpc:record_heartbeat')).toBe(true)
  })

  it('answers 404 for unknown and malformed tokens without leaking anything', async () => {
    const { ctx, calls } = systemTestContext(() => ({ data: null, error: null }))
    await expect(recordHeartbeat(ctx, 'unknown-token-123', { success: true })).rejects.toMatchObject({ code: 'not_found', status: 404, message: 'Heartbeat not found.' })
    await expect(recordHeartbeat(ctx, '../../etc', { success: true })).rejects.toMatchObject({ code: 'not_found' })
    expect(calls).toHaveLength(1)
  })

  it('reports paused monitors as paused', async () => {
    const { ctx } = systemTestContext(() => ({ data: { id: 'm1', state: 'paused' }, error: null }))
    await expect(recordHeartbeat(ctx, 'abcdefabcdef', { success: true })).resolves.toEqual({ state: 'paused' })
  })
})

describe('failureMessageFrom', () => {
  it('prefers the query string, then a JSON body, then form or plain text', () => {
    expect(failureMessageFrom('Backup failed', '{"message":"ignored"}', 'application/json')).toBe('Backup failed')
    expect(failureMessageFrom(null, '{"message":"OOM killed"}', 'application/json')).toBe('OOM killed')
    expect(failureMessageFrom(null, '{"other":1}', 'application/json')).toBeNull()
    expect(failureMessageFrom(null, 'message=disk%20full', 'application/x-www-form-urlencoded')).toBe('disk full')
    expect(failureMessageFrom(null, 'Exit code 3', 'application/x-www-form-urlencoded')).toBe('Exit code 3')
    expect(failureMessageFrom(null, '{not json', 'text/plain')).toBe('{not json')
    expect(failureMessageFrom('', '   ', null)).toBeNull()
    expect(failureMessageFrom(null, 'x'.repeat(900), null)).toHaveLength(500)
  })
})

describe('urls and buckets', () => {
  it('builds the ping URL from the app URL and hashes tokens in rate-limit buckets', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.upvane.test/'
    expect(heartbeatUrl('abc')).toBe('https://app.upvane.test/api/v1/heartbeat/abc')
    const bucket = tokenBucket('heartbeat', 'demo-heartbeat-token-nightly-invoices')
    expect(bucket).toMatch(/^heartbeat:[0-9a-f]{16}$/)
    expect(bucket).not.toContain('demo')
    expect(tokenBucket('heartbeat', 'a')).not.toBe(tokenBucket('heartbeat', 'b'))
    expect(tokenBucket('inbound', 'a')).not.toBe(tokenBucket('heartbeat', 'a'))
  })
})
