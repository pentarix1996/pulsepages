// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { bytesToBase64, decryptJson, decryptSecret, encryptJson, encryptSecret, generateToken, randomBase62, secretHint, sha256Hex, timingSafeEqual } from '@shared/crypto.ts'
import { signWebhookPayload, verifyWebhookSignature } from '@shared/alerts/signing.ts'
import { unsubscribeToken, unsubscribeTokenHash } from '@shared/subscribers.ts'

const key = bytesToBase64(new Uint8Array(32).map((_, index) => index))

describe('secrets', () => {
  it('round-trips with AES-GCM and a fresh IV each time', async () => {
    const a = await encryptSecret('hunter2', key)
    const b = await encryptSecret('hunter2', key)
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+$/)
    expect(a).not.toBe(b)
    expect(await decryptSecret(a, key)).toBe('hunter2')
    expect(await decryptJson(await encryptJson({ url: 'https://x' }, key), key)).toEqual({ url: 'https://x' })
  })

  it('fails on tampering and on the wrong key', async () => {
    const payload = await encryptSecret('secret', key)
    const tampered = payload.slice(0, -2) + (payload.endsWith('A') ? 'BB' : 'AA')
    await expect(decryptSecret(tampered, key)).rejects.toThrow()
    const other = bytesToBase64(new Uint8Array(32).fill(7))
    await expect(decryptSecret(payload, other)).rejects.toThrow()
    await expect(encryptSecret('x', bytesToBase64(new Uint8Array(16)))).rejects.toThrow(/32 bytes/)
  })
})

describe('tokens and hashes', () => {
  it('generates prefixed base62 tokens', () => {
    const token = generateToken('upv_live_')
    expect(token).toMatch(/^upv_live_[0-9A-Za-z]{43}$/)
    expect(randomBase62(10)).toHaveLength(10)
  })

  it('hashes like the database (sha256 hex)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('compares in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })

  it('hints secrets without revealing them', () => {
    expect(secretHint('https://hooks.slack.com/services/T000/B000/XYZ123')).toBe('hooks.slack.com/…Z123')
    expect(secretHint('R0123456789abcdef0123456789abcdef')).toBe('••••cdef')
  })
})

describe('webhook signatures', () => {
  it('signs and verifies, rejecting stale or altered payloads', async () => {
    const header = await signWebhookPayload('whsec', '{"a":1}', 1_700_000_000)
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/)
    expect(await verifyWebhookSignature('whsec', header, '{"a":1}', { now: 1_700_000_100 })).toBe(true)
    expect(await verifyWebhookSignature('whsec', header, '{"a":2}', { now: 1_700_000_100 })).toBe(false)
    expect(await verifyWebhookSignature('whsec', header, '{"a":1}', { now: 1_700_001_000 })).toBe(false)
    expect(await verifyWebhookSignature('other', header, '{"a":1}', { now: 1_700_000_100 })).toBe(false)
  })
})

describe('unsubscribe tokens', () => {
  it('are stable per project and subscriber and stored as a hash', async () => {
    const a = await unsubscribeToken(key, 'project-1', 'email:reader@example.com')
    expect(await unsubscribeToken(key, 'project-1', 'email:reader@example.com')).toBe(a)
    expect(await unsubscribeToken(key, 'project-2', 'email:reader@example.com')).not.toBe(a)
    expect(await unsubscribeTokenHash(key, 'project-1', 'email:reader@example.com')).toBe(await sha256Hex(a))
  })
})
