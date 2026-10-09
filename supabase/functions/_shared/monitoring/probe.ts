// Pure helpers for the monitor-probe Edge Function: request validation, request headers and redirect rules, DNS
// answer formatting, certificate errors and readable network errors. No Deno globals so Vitest covers them; the
// network calls themselves live in supabase/functions/monitor-probe.
import { HTTP_METHODS } from '../domain.ts'
import { MONITOR_DEFAULTS } from './config.ts'
import type { HeaderPair, ProbeRequest } from './types.ts'

export const PROBE_TYPES = ['http', 'keyword', 'tcp', 'dns', 'tls'] as const
export type ProbeType = (typeof PROBE_TYPES)[number]

export const PROBE_USER_AGENT = 'Upvane-Monitor/2.0 (+https://upvane.com)'
export const PROBE_TIMEOUT_BOUNDS = { min: 1000, max: 30_000 } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export function clampTimeout(value: unknown): number {
  const ms = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : MONITOR_DEFAULTS.timeout_ms
  return Math.min(PROBE_TIMEOUT_BOUNDS.max, Math.max(PROBE_TIMEOUT_BOUNDS.min, ms))
}

export type ParsedProbeRequest = { ok: true; request: ProbeRequest } | { ok: false; error: string }

/** Validates the body monitor-runner sends (ProbeRequest). Heartbeats never reach the probe. */
export function parseProbeRequest(body: unknown): ParsedProbeRequest {
  if (!isRecord(body)) return { ok: false, error: 'Send a JSON object with type and config.' }
  const type = body.type
  if (type === 'heartbeat') return { ok: false, error: 'Heartbeat monitors are not probed: they wait for pings.' }
  if (typeof type !== 'string' || !(PROBE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `Unknown monitor type ${truncate(JSON.stringify(type ?? null), 40)}.` }
  }
  if (!isRecord(body.config)) return { ok: false, error: 'config must be an object.' }
  const secret = body.secret_headers
  if (secret !== undefined && secret !== null && typeof secret !== 'string') return { ok: false, error: 'secret_headers must be a string or null.' }
  return {
    ok: true,
    request: {
      monitor_id: typeof body.monitor_id === 'string' ? body.monitor_id.slice(0, 64) : '',
      type: type as ProbeType,
      config: body.config,
      timeout_ms: clampTimeout(body.timeout_ms),
      secret_headers: typeof secret === 'string' && secret !== '' ? secret : null,
    },
  }
}

export function isHttpMethod(value: string): boolean {
  return (HTTP_METHODS as readonly string[]).includes(value)
}

/** Keeps `{ name, value }` entries with string name and value; anything else is dropped. */
export function parseHeaderPairs(value: unknown): HeaderPair[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is HeaderPair => isRecord(item) && typeof item.name === 'string' && typeof item.value === 'string' && item.name.trim() !== '')
    .map((item) => ({ name: item.name.trim(), value: item.value }))
}

export type HeaderList = Array<[string, string]>

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
// Managed by the HTTP client: setting them by hand breaks requests or smuggles a different target.
const CLIENT_MANAGED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-connection'])
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization'])
const BODY_HEADERS = new Set(['content-type', 'content-encoding', 'content-language', 'content-location'])

export type BuiltHeaders = { ok: true; headers: HeaderList; secretNames: string[] } | { ok: false; error: string }

/**
 * Request headers for a check: config headers, then secret headers (which replace config headers with the same
 * name), plus a default User-Agent, Accept and, when there is a body, Content-Type.
 */
export function buildRequestHeaders(configHeaders: unknown, secretHeaders: HeaderPair[], body: string | null = null): BuiltHeaders {
  const secretNames = secretHeaders.map((header) => header.name.trim().toLowerCase())
  const pairs = [...parseHeaderPairs(configHeaders).filter((header) => !secretNames.includes(header.name.toLowerCase())), ...secretHeaders]
  const headers: HeaderList = []
  const present = new Set<string>()
  for (const pair of pairs) {
    const name = pair.name.trim()
    if (!HEADER_NAME.test(name)) return { ok: false, error: `The header name "${truncate(name, 40)}" is not valid.` }
    if (/[\r\n\0]/.test(pair.value)) return { ok: false, error: `The value of header ${name} contains a line break.` }
    const lower = name.toLowerCase()
    if (CLIENT_MANAGED_HEADERS.has(lower)) continue
    headers.push([name, pair.value])
    present.add(lower)
  }
  if (!present.has('user-agent')) headers.push(['User-Agent', PROBE_USER_AGENT])
  if (!present.has('accept')) headers.push(['Accept', '*/*'])
  if (body !== null && body !== '' && !present.has('content-type')) headers.push(['Content-Type', looksLikeJson(body) ? 'application/json' : 'text/plain; charset=utf-8'])
  return { ok: true, headers, secretNames }
}

function looksLikeJson(body: string): boolean {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

export const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308]

export function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.includes(status)
}

/** Fetch-spec method rewriting: 303 → GET (except HEAD), 301/302 POST → GET, 307/308 keep method and body. */
export function redirectMethod(status: number, method: string): { method: string; keepBody: boolean } {
  const upper = method.toUpperCase()
  const hasBody = upper !== 'GET' && upper !== 'HEAD'
  if (status === 303 && upper !== 'HEAD') return { method: 'GET', keepBody: false }
  if ((status === 301 || status === 302) && upper === 'POST') return { method: 'GET', keepBody: false }
  return { method: upper, keepBody: hasBody }
}

/** Absolute URL of a Location header (relative locations resolve against the current URL). */
export function resolveRedirectUrl(currentUrl: string, location: string | null | undefined): string | null {
  if (!location || location.trim() === '') return null
  try {
    const url = new URL(location.trim(), currentUrl)
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

/** Headers for the next hop: credentials and secret headers never follow a redirect to another origin. */
export function headersForRedirect(headers: HeaderList, secretNames: string[], toSameOrigin: boolean, keepBody: boolean): HeaderList {
  return headers.filter(([name]) => {
    const lower = name.toLowerCase()
    if (!keepBody && BODY_HEADERS.has(lower)) return false
    if (!toSameOrigin && (CREDENTIAL_HEADERS.has(lower) || secretNames.includes(lower))) return false
    return true
  })
}

/** Keyword monitors and body/json assertions need the response body; everything else only needs the headers. */
export function needsResponseBody(type: string, config: Record<string, unknown>): boolean {
  if (type === 'keyword') return true
  const assertions = config.assertions
  return Array.isArray(assertions) && assertions.some((assertion) => isRecord(assertion) && (assertion.source === 'body' || assertion.source === 'json'))
}

export function headersToRecord(headers: Iterable<[string, string]>): Record<string, string> {
  const record: Record<string, string> = {}
  for (const [name, value] of headers) {
    const key = name.toLowerCase()
    record[key] = key in record ? `${record[key]}, ${value}` : value
  }
  return record
}

/** IPv4 addresses first: they are reachable from every probe region, IPv6 egress is not guaranteed. */
export function preferIPv4(addresses: string[]): string[] {
  const v4 = addresses.filter((address) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address))
  return [...v4, ...addresses.filter((address) => !v4.includes(address))]
}

/**
 * DNS answers as comparable strings (see evaluateDnsAnswers). MX and CAA records produce two forms so users can
 * expect either the bare value (`mx1.example.com`, `letsencrypt.org`) or the full record (`10 mx1.example.com`).
 */
export function formatDnsAnswers(recordType: string, records: unknown[]): string[] {
  const answers: string[] = []
  const push = (value: string) => {
    const trimmed = value.trim()
    if (trimmed !== '' && !answers.includes(trimmed)) answers.push(trimmed)
  }
  for (const record of records) {
    if (typeof record === 'string') push(record)
    else if (Array.isArray(record)) push(record.map(String).join(''))
    else if (isRecord(record)) {
      if (recordType === 'MX' && typeof record.exchange === 'string') {
        push(`${Number(record.preference ?? 0)} ${record.exchange}`)
        push(record.exchange)
      } else if (recordType === 'CAA' && typeof record.tag === 'string') {
        push(`${record.critical ? 128 : 0} ${record.tag} "${String(record.value ?? '')}"`)
        push(String(record.value ?? ''))
      } else {
        push(JSON.stringify(record))
      }
    } else if (record !== null && record !== undefined) {
      push(String(record))
    }
  }
  return answers
}

/** `getPeerCertificate().valid_to` ("Nov  8 02:32:17 2026 GMT") as a Date. */
export function parseCertificateDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const date = new Date(value.replace(/\s+/g, ' ').trim())
  return Number.isNaN(date.getTime()) ? null : date
}

const TLS_AUTHORIZATION_ERRORS: Record<string, string> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The certificate is self-signed.',
  SELF_SIGNED_CERT_IN_CHAIN: 'The certificate chain contains a self-signed certificate.',
  UNABLE_TO_GET_ISSUER_CERT: 'The certificate was issued by an unknown authority.',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'The certificate was issued by an unknown authority.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The certificate chain is incomplete: the server does not send the intermediate certificates.',
  CERT_UNTRUSTED: 'The certificate is not trusted.',
  CERT_HAS_EXPIRED: 'The certificate has expired.',
  CERT_NOT_YET_VALID: 'The certificate is not valid yet.',
  CERT_REVOKED: 'The certificate was revoked.',
  CERT_SIGNATURE_FAILURE: 'The certificate signature is invalid.',
}

/** Readable text for node:tls `authorizationError` codes (an untrusted chain makes a TLS check down). */
export function describeTlsAuthorizationError(code: unknown, hostname: string): string {
  const value = typeof code === 'string' ? code : code instanceof Error ? ((code as Error & { code?: string }).code ?? code.message) : ''
  if (value === 'ERR_TLS_CERT_ALTNAME_INVALID' || /altname|hostname|not valid for name/i.test(value)) return `The certificate is not valid for ${hostname}.`
  if (TLS_AUTHORIZATION_ERRORS[value]) return TLS_AUTHORIZATION_ERRORS[value]
  return value ? `The certificate is not trusted (${truncate(value, 80)}).` : 'The certificate is not trusted.'
}

/** Messages of an error and its causes, outermost first. Deno's fetch hides the useful part in `cause`. */
export function errorChainText(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current !== undefined && current !== null && depth < 6; depth++) {
    if (typeof current === 'object' && 'message' in current) {
      const name = 'name' in current ? String((current as { name: unknown }).name) : 'Error'
      parts.push(`${name}: ${String((current as { message: unknown }).message)}`)
      current = (current as { cause?: unknown }).cause
    } else {
      parts.push(String(current))
      break
    }
  }
  return parts.join(' | ')
}

export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false
  const name = String((error as { name: unknown }).name)
  return name === 'TimeoutError' || name === 'AbortError' || name === 'TimedOut'
}

export function formatDuration(ms: number): string {
  return ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${Math.round(ms)} ms`
}

// Deno puts the request URL in its error messages; drop it so a host such as tls.example.com cannot be read as a cause.
function stripUrls(text: string): string {
  return text.replace(/\(?\b[a-z][a-z0-9+.-]*:\/\/[^\s)]*\)?/gi, '(url)')
}

/** A readable sentence for a failed connection, request or handshake. */
export function describeNetworkError(error: unknown, options: { timeoutMs?: number; hostname?: string } = {}): string {
  if (isTimeoutError(error)) return options.timeoutMs ? `Timed out after ${formatDuration(options.timeoutMs)}.` : 'Timed out.'
  const raw = stripUrls(errorChainText(error))
  const text = raw.toLowerCase()
  const host = options.hostname ? ` ${options.hostname}` : ''
  if (/certificate|unknownissuer|notvalidforname|causedasendentity/.test(text)) {
    if (text.includes('expired')) return 'TLS error: the certificate has expired.'
    if (/notvalidforname|not valid for name|altname/.test(text)) return `TLS error: the certificate is not valid for${host || ' this host'}.`
    if (/unknownissuer|unknown issuer|unable to get issuer/.test(text)) return 'TLS error: the certificate was issued by an unknown authority.'
    if (/self.?signed|causedasendentity/.test(text)) return 'TLS error: the certificate is self-signed.'
    return 'TLS error: the certificate is not valid.'
  }
  if (/connection refused|econnrefused|connectionrefused/.test(text)) return 'Connection refused.'
  if (/dns error|failed to lookup|name or service not known|no such host|nodename nor servname|enotfound/.test(text)) return `Could not resolve${host || ' the host'}.`
  if (/timed out|timedout|etimedout/.test(text)) return 'The connection timed out.'
  if (/connection reset|reset by peer|econnreset|connectionreset/.test(text)) return 'The connection was reset.'
  if (/network is unreachable|no route to host|host is unreachable|ehostunreach|enetunreach/.test(text)) return 'The host is unreachable from this region.'
  if (/unexpected eof|unexpectedeof|connection closed|incomplete message|error reading a body/.test(text)) return 'The connection closed before the response was complete.'
  if (/handshake|\btls\b|\bssl\b/.test(text)) return 'The TLS handshake failed.'
  if (text.includes('unsuccessful tunnel')) return 'Could not connect through the outbound proxy.'
  if (text.includes('are blocked')) return 'Requests to this port are not allowed.'
  if (/invalid http|http2|invalid status|parse error|invalid response/.test(text)) return 'The server sent an invalid HTTP response.'
  const innermost = raw.split(' | ').pop() ?? ''
  return `The request failed: ${truncate(innermost.replace(/^[A-Za-z]*(Error|Exception)?: /, ''), 160)}`
}
