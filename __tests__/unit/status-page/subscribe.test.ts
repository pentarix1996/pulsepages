// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { decryptJson } from '@shared/crypto.ts'
import type { SubscribeDeps } from '@/lib/status-page/subscribe'
import type { StatusPageData } from '@/lib/status-page/types'

vi.mock('@/lib/status-page/data', () => ({
  adminRpc: vi.fn(),
  StatusPageLoadError: class StatusPageLoadError extends Error {
    constructor(
      readonly fn: string,
      readonly cause: { code?: string; message?: string },
    ) {
      super(cause.message)
    }
  },
}))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))

const { StatusPageLoadError } = await import('@/lib/status-page/data')
const { normalizeSubscribeFields, subscribeInput, subscribeToPage } = await import('@/lib/status-page/subscribe')

const KEY = Buffer.alloc(32, 7).toString('base64')
const API = 'c1111111-1111-4111-8111-111111111111'

const PAGE = {
  project: { id: '44444444-4444-4444-8444-444444444444', name: 'Quillbase', brand_color: '#0E7490', logo_url: null },
  components: [{ id: API, name: 'API' }],
} as unknown as StatusPageData

function deps(overrides: Partial<SubscribeDeps> = {}) {
  const rpc = vi.fn(async () => 'created' as never)
  const sendEmail = vi.fn(async () => ({ ok: true as const, id: 'email-1' }))
  return {
    rpc,
    sendEmail,
    deps: {
      secretsKey: () => KEY,
      appUrl: () => 'https://app.upvane.com',
      rpc,
      sendEmail,
      resolve: async () => ['93.184.216.34'],
      ...overrides,
    } as SubscribeDeps,
  }
}

describe('subscribe input', () => {
  it('normalises form fields', () => {
    expect(normalizeSubscribeFields({ email: 'A@B.co', component_ids: `${API}, ` })).toEqual({ type: 'email', email: 'A@B.co', component_ids: [API] })
    expect(normalizeSubscribeFields({ type: 'Slack', webhook_url: 'https://hooks.slack.com/x' })).toEqual({ type: 'slack', url: 'https://hooks.slack.com/x' })
  })

  it('lowercases emails and explains bad ones', () => {
    expect(subscribeInput.parse({ type: 'email', email: '  Ana@Example.COM ' })).toEqual({ type: 'email', email: 'ana@example.com' })
    const result = subscribeInput.safeParse({ type: 'email', email: 'ana' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Enter a full email address, like you@company.com.')
  })
})

describe('subscribeToPage', () => {
  it('stores only hashes for email and sends the confirmation link', async () => {
    const { deps: d, rpc, sendEmail } = deps()
    const outcome = await subscribeToPage(PAGE, { type: 'email', email: 'ana@example.com', component_ids: [API, API] }, d)
    expect(outcome.result).toBe('confirmation_sent')
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(args).toMatchObject({ p_type: 'email', p_email: 'ana@example.com', p_component_ids: [API], p_target_encrypted: null })
    expect(args.p_confirm_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof args.p_unsubscribe_token_hash).toBe('string')
    const email = (sendEmail.mock.calls[0] as unknown as [{ to: string; html: string; idempotencyKey: string }])[0]
    expect(email.to).toBe('ana@example.com')
    expect(email.html).toContain('https://app.upvane.com/subscriptions/confirm?token=sub_')
    expect(email.html).not.toContain(String(args.p_confirm_token_hash))
  })

  it('answers already subscribed without sending another email', async () => {
    const { deps: d, sendEmail } = deps({ rpc: (async () => 'already_confirmed') as SubscribeDeps['rpc'] })
    expect((await subscribeToPage(PAGE, { type: 'email', email: 'ana@example.com' }, d)).result).toBe('already_subscribed')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rejects components from other pages', async () => {
    const { deps: d, rpc } = deps()
    await expect(subscribeToPage(PAGE, { type: 'email', email: 'ana@example.com', component_ids: ['c9999999-1111-4111-8111-111111111111'] }, d)).rejects.toMatchObject({ code: 'invalid_request' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps database errors to visitor-facing answers', async () => {
    const failing = (code: string, message = '') => deps({ rpc: (async () => { throw new StatusPageLoadError('subscribe_to_status_page', { code, message }) }) as SubscribeDeps['rpc'] }).deps
    expect((await subscribeToPage(PAGE, { type: 'email', email: 'ana@example.com' }, failing('23505'))).result).toBe('already_subscribed')
    await expect(subscribeToPage(PAGE, { type: 'email', email: 'ana@example.com' }, failing('P0001', 'Too many subscribers'))).rejects.toMatchObject({ code: 'conflict' })
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    await expect(subscribeToPage(PAGE, { type: 'email', email: 'ana@example.com' }, failing('XX000'))).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('fails clearly when the confirmation email cannot be sent', async () => {
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    const { deps: d } = deps({ sendEmail: (async () => ({ ok: false, error: 'down' })) as unknown as SubscribeDeps['sendEmail'] })
    await expect(subscribeToPage(PAGE, { type: 'email', email: 'ana@example.com' }, d)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('only accepts Slack webhook URLs for Slack and encrypts the target', async () => {
    const { deps: d, rpc } = deps()
    await expect(subscribeToPage(PAGE, { type: 'slack', url: 'https://example.com/hook' }, d)).rejects.toMatchObject({ code: 'invalid_request' })
    const outcome = await subscribeToPage(PAGE, { type: 'slack', url: 'https://hooks.slack.com/services/T000/B000/XXXX' }, d)
    expect(outcome.result).toBe('subscribed')
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(args.p_target_encrypted).toMatch(/^v1\./)
    expect(JSON.stringify(args)).not.toContain('hooks.slack.com/services/T000/B000/XXXX')
    expect(await decryptJson(String(args.p_target_encrypted), KEY)).toEqual({ webhook_url: 'https://hooks.slack.com/services/T000/B000/XXXX' })
  })

  it('blocks webhooks that resolve to private addresses and returns a signing secret once', async () => {
    const internal = deps({ resolve: async () => ['10.0.0.5'] })
    await expect(subscribeToPage(PAGE, { type: 'webhook', url: 'https://hooks.example.com/upvane' }, internal.deps)).rejects.toMatchObject({ code: 'invalid_request' })
    expect(internal.rpc).not.toHaveBeenCalled()

    const { deps: d, rpc } = deps()
    const outcome = await subscribeToPage(PAGE, { type: 'webhook', url: 'https://hooks.example.com/upvane' }, d)
    expect(outcome).toMatchObject({ result: 'subscribed', signing_secret: expect.stringMatching(/^whsec_/) })
    const stored = await decryptJson(String((rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1].p_target_encrypted), KEY)
    expect(stored).toEqual({ url: 'https://hooks.example.com/upvane', signing_secret: (outcome as { signing_secret: string }).signing_secret })
  })
})
