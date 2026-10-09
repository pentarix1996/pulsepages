// Bearer secrets for function-to-function and cron calls. Compares SHA-256 digests in constant time, so neither the
// secret's content nor its length leaks through timing.
import { sha256Hex, timingSafeEqual } from '../crypto.ts'

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1]!.trim() : null
}

/** True when the request carries one of the configured secrets. Fails closed when none is configured. */
export async function hasBearerSecret(request: Request, secrets: Array<string | null | undefined>): Promise<boolean> {
  const configured = secrets.filter((secret): secret is string => typeof secret === 'string' && secret.length > 0)
  if (configured.length === 0) return false
  const presented = await sha256Hex(bearerToken(request) ?? '')
  let matched = false
  for (const secret of configured) {
    // Evaluate every comparison (no short-circuit) so the time does not depend on which secret matched.
    matched = timingSafeEqual(presented, await sha256Hex(secret)) || matched
  }
  return matched
}
