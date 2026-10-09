// Shared shapes of the inbound alert parsers (spec §8). Parsers are pure: they turn a provider's webhook body into
// InboundAlert[]; lib/domain/inbound/mapping.ts turns alerts into component signals for ingest_signals().
import type { ProblemStatus } from '@shared/domain.ts'

export interface InboundAlert {
  /** Stable id of the alert at the source (fingerprint, alarm ARN, monitor id + scope). */
  external_id: string
  /** True while the alert fires; false when it resolved. */
  active: boolean
  /** Labels used by mappings (lowercase keys are not enforced; matching ignores case). */
  labels: Record<string, string>
  summary: string | null
  /** Severity word from the source (critical, warning, p1…); turned into a status when no mapping sets one. */
  severity: string | null
  /** Status the sender asked for explicitly (generic payloads). */
  status?: ProblemStatus | null
  /** Component id or key the sender asked for explicitly (generic payloads). */
  component?: string | null
}

export type InboundPayload =
  | { kind: 'alerts'; alerts: InboundAlert[]; ignored: number }
  /** Amazon SNS asks to confirm the HTTPS subscription before it sends notifications. */
  | { kind: 'subscription_confirmation'; subscribeUrl: string; topicArn: string | null }
  | { kind: 'ignored'; reason: string }

/** A payload Upvane cannot read. The message is shown to the admin (integration last_error) and returned as 422. */
export class InboundParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InboundParseError'
  }
}

export const MAX_ALERTS_PER_PAYLOAD = 1000
const MAX_LABELS = 100
const MAX_KEY = 100
const MAX_VALUE = 500

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!isObject(value)) throw new InboundParseError(message)
  return value
}

/** Trimmed string for strings and numbers; empty string otherwise. */
export function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Scalar entries of an object as trimmed strings (nested values are dropped). */
export function toLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  if (!isObject(value)) return labels
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (Object.keys(labels).length >= MAX_LABELS) break
    const key = rawKey.trim().slice(0, MAX_KEY)
    if (!key) continue
    if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      labels[key] = String(rawValue).trim().slice(0, MAX_VALUE)
    }
  }
  return labels
}

/** Case-insensitive label lookup. */
export function labelValue(labels: Record<string, string>, key: string): string | undefined {
  if (key in labels) return labels[key]
  const lower = key.toLowerCase()
  for (const [name, value] of Object.entries(labels)) if (name.toLowerCase() === lower) return value
  return undefined
}

/** FNV-1a 64-bit, hex. Identity only (not a security hash). */
export function fnv1a64(input: string): string {
  let hash = BigInt('0xcbf29ce484222325')
  const prime = BigInt('0x100000001b3')
  const mask = BigInt('0xffffffffffffffff')
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

/** Stable id for alerts without a fingerprint: hash of the sorted labels. */
export function labelsId(labels: Record<string, string>): string {
  const canonical = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join('\n')
  return `labels:${fnv1a64(canonical)}`
}

export function checkAlertCount(count: number): void {
  if (count > MAX_ALERTS_PER_PAYLOAD) {
    throw new InboundParseError(`The payload has ${count} alerts; Upvane reads at most ${MAX_ALERTS_PER_PAYLOAD} per request. Group alerts or lower max_alerts.`)
  }
}
