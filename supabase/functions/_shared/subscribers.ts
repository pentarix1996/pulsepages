// Status page subscriber tokens. The unsubscribe token is derived (HMAC) so every notification can carry a working
// unsubscribe link while the database only stores its SHA-256 hash.
import { bytesToBase64Url, hmacSha256Hex, sha256Hex } from './crypto.ts'

export function subscriberKey(input: { type: 'email' | 'slack' | 'webhook'; email?: string | null; targetUrl?: string | null }): string {
  if (input.type === 'email') return `email:${(input.email ?? '').trim().toLowerCase()}`
  return `${input.type}:${(input.targetUrl ?? '').trim()}`
}

export async function unsubscribeToken(secretKey: string, projectId: string, key: string): Promise<string> {
  const hex = await hmacSha256Hex(secretKey, `upvane-unsubscribe:${projectId}:${key}`)
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((pair) => parseInt(pair, 16)))
  return bytesToBase64Url(bytes)
}

export async function unsubscribeTokenHash(secretKey: string, projectId: string, key: string): Promise<string> {
  return sha256Hex(await unsubscribeToken(secretKey, projectId, key))
}

export function unsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/subscriptions/unsubscribe?token=${encodeURIComponent(token)}`
}

export function confirmSubscriptionUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/subscriptions/confirm?token=${encodeURIComponent(token)}`
}
