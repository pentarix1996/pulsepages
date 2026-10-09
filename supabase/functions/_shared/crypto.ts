// AES-256-GCM secrets, hashing, HMAC and tokens on WebCrypto (Node 20+ and Deno).
// Encrypted format: v1.<iv base64url>.<ciphertext+tag base64url>. Key: UPVANE_SECRETS_KEY, 32 random bytes in base64.

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const keyCache = new Map<string, Promise<CryptoKey>>()

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return base64ToBytes(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function importAesKey(base64Key: string): Promise<CryptoKey> {
  const cached = keyCache.get(base64Key)
  if (cached) return cached
  const raw = base64ToBytes(base64Key.trim())
  if (raw.length !== 32) throw new Error('UPVANE_SECRETS_KEY must be 32 bytes encoded in base64.')
  const promise = crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  keyCache.set(base64Key, promise)
  return promise
}

export async function encryptSecret(plaintext: string, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)))
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`
}

export async function decryptSecret(payload: string, base64Key: string): Promise<string> {
  const [version, ivPart, dataPart] = payload.split('.')
  if (version !== 'v1' || !ivPart || !dataPart) throw new Error('Unsupported secret format.')
  const key = await importAesKey(base64Key)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(ivPart) }, key, base64UrlToBytes(dataPart))
  return decoder.decode(plaintext)
}

export async function encryptJson(value: unknown, base64Key: string): Promise<string> {
  return encryptSecret(JSON.stringify(value), base64Key)
}

export async function decryptJson<T>(payload: string, base64Key: string): Promise<T> {
  return JSON.parse(await decryptSecret(payload, base64Key)) as T
}

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))))
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Unbiased base62 string with `length` characters (rejection sampling). */
export function randomBase62(length: number): string {
  let out = ''
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const byte of bytes) {
      if (byte >= 248) continue // 248 = 62 * 4, keeps the distribution uniform
      out += BASE62[byte % 62]
      if (out.length === length) break
    }
  }
  return out
}

/** Prefixed token, e.g. upv_live_<43 chars> (≈256 bits). */
export function generateToken(prefix: string, length = 43): string {
  return `${prefix}${randomBase62(length)}`
}

/** Constant-time string comparison for secrets of equal length. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

/** A short, non-secret reminder of a secret (host of a URL or last characters), shown in the UI. */
export function secretHint(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    const tail = url.pathname.replace(/\/+$/, '').slice(-4)
    return `${url.host}/…${tail}`
  } catch {
    return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`
  }
}
