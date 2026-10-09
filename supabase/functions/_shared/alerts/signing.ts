// Webhook signatures: Upvane-Signature: t=<unix seconds>,v1=<hex hmac-sha256(secret, `${t}.${body}`)>
import { hmacSha256Hex, timingSafeEqual } from '../crypto.ts'

export const SIGNATURE_HEADER = 'Upvane-Signature'
export const DEFAULT_TOLERANCE_SECONDS = 300

export async function signWebhookPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const signature = await hmacSha256Hex(secret, `${timestamp}.${body}`)
  return `t=${timestamp},v1=${signature}`
}

export function parseSignatureHeader(header: string | null | undefined): { timestamp: number; signatures: string[] } | null {
  if (!header) return null
  let timestamp = Number.NaN
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2).map((item) => item?.trim())
    if (key === 't') timestamp = Number(value)
    if (key === 'v1' && value) signatures.push(value)
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null
  return { timestamp, signatures }
}

/** Verifies a signature the way receivers should: HMAC match and timestamp inside the tolerance window. */
export async function verifyWebhookSignature(secret: string, header: string | null | undefined, body: string, options: { now?: number; toleranceSeconds?: number } = {}): Promise<boolean> {
  const parsed = parseSignatureHeader(header)
  if (!parsed) return false
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - parsed.timestamp) > (options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) return false
  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${body}`)
  return parsed.signatures.some((signature) => timingSafeEqual(signature, expected))
}
