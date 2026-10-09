// The checks monitor-probe runs in its region: http, keyword, tcp, dns and tls. Network access is injected
// (ProbeDeps) so tests stay hermetic; handler.ts wires the Deno implementations.
//
// Status rules: anything wrong with the target (timeouts, DNS failures, refused connections, SSRF rejections, bad
// certificates, failed assertions) is `down`/`degraded`; only failures of the probe itself (bad request, missing
// secrets key, no DNS in the runtime) are `error`, which the state machine ignores.
import { decryptJson } from '../_shared/crypto.ts'
import { DNS_RECORD_TYPES } from '../_shared/domain.ts'
import type { CheckResultStatus } from '../_shared/domain.ts'
import { addressResolver, isDnsNotFound } from '../_shared/edge/dns.ts'
import type { RecordLookup } from '../_shared/edge/dns.ts'
import { discardBody, readTextLimited, withTimeout } from '../_shared/edge/http.ts'
import { evaluateDnsAnswers, evaluateHttpResponse, evaluateTlsExpiry, MAX_BODY_BYTES } from '../_shared/monitoring/assertions.ts'
import { dnsConfig, httpConfig, MONITOR_DEFAULTS, tcpConfig, tlsConfig } from '../_shared/monitoring/config.ts'
import {
  buildRequestHeaders,
  describeNetworkError,
  describeTlsAuthorizationError,
  formatDnsAnswers,
  formatDuration,
  headersForRedirect,
  headersToRecord,
  isHttpMethod,
  isRedirectStatus,
  needsResponseBody,
  parseHeaderPairs,
  preferIPv4,
  redirectMethod,
  resolveRedirectUrl,
  sameOrigin,
} from '../_shared/monitoring/probe.ts'
import { isIpLiteral, validateHostname, validateMonitorUrl, validateResolvedHost } from '../_shared/monitoring/ssrf.ts'
import type { HeaderPair, ProbeRequest, ProbeResult } from '../_shared/monitoring/types.ts'

export interface TlsPeer {
  validFrom: Date | null
  validTo: Date | null
  /** The chain verifies against the trust store and the certificate matches the hostname. */
  authorized: boolean
  /** node:tls code such as DEPTH_ZERO_SELF_SIGNED_CERT or ERR_TLS_CERT_ALTNAME_INVALID. */
  authorizationError: string | null
  subject: string | null
  issuer: string | null
  protocol: string | null
}

export interface TlsHandshakeInput {
  address: string
  port: number
  /** SNI; null for IP literals. */
  servername: string | null
  /** Name the certificate must be valid for. */
  hostname: string
  signal: AbortSignal
}

export interface ProbeDeps {
  fetch: typeof fetch
  /** Deno.resolveDns; null when the runtime has no DNS (checks then report an error, not a down). */
  lookup: RecordLookup | null
  /** Opens a TCP connection to address:port and closes it again. */
  connectTcp(address: string, port: number, signal: AbortSignal): Promise<void>
  tlsHandshake(input: TlsHandshakeInput): Promise<TlsPeer>
  /** UPVANE_SECRETS_KEY; only needed by monitors with secret headers. */
  secretsKey: string | undefined
  now(): Date
  /** Monotonic milliseconds, for latencies. */
  clock(): number
}

interface ResultFields {
  latency?: number | null
  httpStatus?: number | null
  error?: string | null
  tlsExpiresAt?: Date | null
  details?: Record<string, unknown>
}

interface CheckContext {
  region: string
  deps: ProbeDeps
  signal: AbortSignal
  timeoutMs: number
  checkedAt: string
}

/** Extra time after the deadline before the probe answers with a timeout no matter what is still pending. */
const HARD_STOP_GRACE_MS = 1500

function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function build(ctx: CheckContext, status: CheckResultStatus, fields: ResultFields = {}): ProbeResult {
  const result: ProbeResult = {
    region: ctx.region,
    status,
    latency_ms: typeof fields.latency === 'number' && Number.isFinite(fields.latency) ? Math.max(0, Math.round(fields.latency)) : null,
    http_status: fields.httpStatus ?? null,
    error: fields.error ?? null,
    checked_at: ctx.checkedAt,
  }
  if (fields.tlsExpiresAt) result.tls_expires_at = fields.tlsExpiresAt.toISOString()
  if (fields.details && Object.keys(fields.details).length > 0) result.details = fields.details
  return result
}

const down = (ctx: CheckContext, error: string, fields: ResultFields = {}) => build(ctx, 'down', { ...fields, error })
const probeError = (ctx: CheckContext, error: string, fields: ResultFields = {}) => build(ctx, 'error', { ...fields, error })

type Resolution = { ok: true; addresses: string[] } | { ok: false; result: ProbeResult }

/** Resolves a host and rejects private, local and reserved addresses (SSRF), right before connecting. */
async function resolveTarget(ctx: CheckContext, hostname: string, details: Record<string, unknown> = {}): Promise<Resolution> {
  if (!ctx.deps.lookup) return { ok: false, result: probeError(ctx, 'DNS resolution is not available in this probe.', { details }) }
  const verdict = await validateResolvedHost(hostname, addressResolver(ctx.deps.lookup, ctx.signal))
  if (verdict.ok) return { ok: true, addresses: verdict.addresses ?? [] }
  if (ctx.signal.aborted) return { ok: false, result: down(ctx, `Timed out after ${formatDuration(ctx.timeoutMs)} while resolving ${hostname}.`, { details }) }
  return { ok: false, result: down(ctx, verdict.reason, { details }) }
}

async function readSecretHeaders(ctx: CheckContext, encrypted: string | null): Promise<{ ok: true; headers: HeaderPair[] } | { ok: false; error: string }> {
  if (!encrypted) return { ok: true, headers: [] }
  if (!ctx.deps.secretsKey) return { ok: false, error: 'This probe cannot read secret headers: UPVANE_SECRETS_KEY is not set.' }
  try {
    return { ok: true, headers: parseHeaderPairs(await decryptJson<unknown>(encrypted, ctx.deps.secretsKey)) }
  } catch {
    return { ok: false, error: 'The secret headers could not be decrypted. Save them again.' }
  }
}

async function checkHttp(ctx: CheckContext, request: ProbeRequest): Promise<ProbeResult> {
  const config = httpConfig(request.config)
  const method = String(config.method ?? 'GET').toUpperCase()
  if (!isHttpMethod(method)) return probeError(ctx, `Unsupported HTTP method ${truncate(method, 20)}.`)
  const secret = await readSecretHeaders(ctx, request.secret_headers)
  if (!secret.ok) return probeError(ctx, secret.error)
  let body = method !== 'GET' && method !== 'HEAD' && typeof config.body === 'string' && config.body !== '' ? config.body : null
  const built = buildRequestHeaders(config.headers, secret.headers, body)
  if (!built.ok) return probeError(ctx, built.error)

  let headers = built.headers
  let currentMethod = method
  let url = config.url
  let latency = 0
  let addresses: string[] = []
  const chain: string[] = []
  const details = (extra: Record<string, unknown> = {}) => ({
    final_url: url,
    redirects: chain.length,
    ...(chain.length > 0 ? { redirect_chain: chain } : {}),
    ...(addresses.length > 0 ? { resolved_ips: addresses } : {}),
    ...extra,
  })

  for (;;) {
    // SSRF rules before the first request and before every redirect hop.
    const target = validateMonitorUrl(url)
    if (!target.ok) return down(ctx, chain.length > 0 ? `The redirect to ${truncate(url)} was blocked: ${target.reason}` : target.reason, { details: details() })
    url = target.url ?? url
    const resolved = await resolveTarget(ctx, target.hostname, details())
    if (!resolved.ok) return resolved.result
    addresses = resolved.addresses

    const started = ctx.deps.clock()
    let response: Response
    try {
      response = await ctx.deps.fetch(url, { method: currentMethod, headers, body: body ?? undefined, redirect: 'manual', signal: ctx.signal })
    } catch (error) {
      return down(ctx, describeNetworkError(error, { timeoutMs: ctx.timeoutMs, hostname: target.hostname }), { details: details() })
    }
    latency += ctx.deps.clock() - started

    const location = response.headers.get('location')
    if (config.follow_redirects && isRedirectStatus(response.status) && location !== null) {
      await discardBody(response)
      const next = resolveRedirectUrl(url, location)
      if (!next) return down(ctx, `The server redirected to an invalid location (${truncate(location)}).`, { latency, httpStatus: response.status, details: details() })
      if (chain.length >= MONITOR_DEFAULTS.max_redirects) {
        return down(ctx, `Stopped after ${MONITOR_DEFAULTS.max_redirects} redirects.`, { latency, httpStatus: response.status, details: details() })
      }
      const rewrite = redirectMethod(response.status, currentMethod)
      headers = headersForRedirect(headers, built.secretNames, sameOrigin(url, next), rewrite.keepBody)
      if (!rewrite.keepBody) body = null
      currentMethod = rewrite.method
      chain.push(next)
      url = next
      continue
    }

    let bodyText: string | null = null
    let truncated = false
    if (currentMethod !== 'HEAD' && needsResponseBody(request.type, request.config)) {
      try {
        const read = await readTextLimited(response, MAX_BODY_BYTES)
        bodyText = read.text
        truncated = read.truncated
      } catch (error) {
        const reason = describeNetworkError(error, { timeoutMs: ctx.timeoutMs, hostname: target.hostname })
        return down(ctx, `Could not read the response body. ${reason}`, { latency, httpStatus: response.status, details: details() })
      }
    } else {
      await discardBody(response)
    }

    const outcome = evaluateHttpResponse(config, { status: response.status, headers: headersToRecord(response.headers), bodyText, latencyMs: latency }, { keywordCheck: request.type === 'keyword' })
    return build(ctx, outcome.status, {
      latency,
      httpStatus: response.status,
      error: outcome.error,
      details: details({ ...(outcome.failures.length > 0 ? { failures: outcome.failures } : {}), ...(truncated ? { body_truncated: true } : {}) }),
    })
  }
}

async function checkTcp(ctx: CheckContext, request: ProbeRequest): Promise<ProbeResult> {
  const config = tcpConfig(request.config)
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) return probeError(ctx, 'The port must be between 1 and 65535.')
  const resolved = await resolveTarget(ctx, config.host, { port: config.port })
  if (!resolved.ok) return resolved.result
  const address = preferIPv4(resolved.addresses)[0]!
  const details = { address, port: config.port, resolved_ips: resolved.addresses }
  const started = ctx.deps.clock()
  try {
    await ctx.deps.connectTcp(address, config.port, ctx.signal)
  } catch (error) {
    return down(ctx, describeNetworkError(error, { timeoutMs: ctx.timeoutMs, hostname: config.host }), { details })
  }
  const latency = ctx.deps.clock() - started
  const threshold = config.latency_threshold_ms
  if (typeof threshold === 'number' && threshold > 0 && latency > threshold) {
    return build(ctx, 'degraded', { latency, error: `Connected in ${Math.round(latency)} ms, slower than ${threshold} ms.`, details })
  }
  return build(ctx, 'up', { latency, details })
}

async function checkDns(ctx: CheckContext, request: ProbeRequest): Promise<ProbeResult> {
  const config = dnsConfig(request.config)
  if (!(DNS_RECORD_TYPES as readonly string[]).includes(config.record_type)) return probeError(ctx, `Unsupported record type ${truncate(config.record_type, 10)}.`)
  const host = validateHostname(config.hostname)
  if (!host.ok) return down(ctx, host.reason, { details: { record_type: config.record_type } })
  if (!ctx.deps.lookup) return probeError(ctx, 'DNS resolution is not available in this probe.')
  const started = ctx.deps.clock()
  let records: unknown[]
  try {
    records = await ctx.deps.lookup(host.hostname, config.record_type, ctx.signal)
  } catch (error) {
    if (!isDnsNotFound(error)) {
      return down(ctx, `The DNS lookup failed. ${describeNetworkError(error, { timeoutMs: ctx.timeoutMs, hostname: host.hostname })}`, { details: { record_type: config.record_type } })
    }
    records = []
  }
  const latency = ctx.deps.clock() - started
  const answers = formatDnsAnswers(config.record_type, records)
  const details = { record_type: config.record_type, answers: answers.slice(0, 50) }
  if (answers.length === 0) return down(ctx, `No ${config.record_type} records found for ${host.hostname}.`, { latency, details })
  const outcome = evaluateDnsAnswers(answers, config.expected_values, config.match)
  return build(ctx, outcome.status, { latency, error: outcome.error, details: { ...details, ...(outcome.failures.length > 0 ? { failures: outcome.failures } : {}) } })
}

async function checkTls(ctx: CheckContext, request: ProbeRequest): Promise<ProbeResult> {
  const config = tlsConfig(request.config)
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) return probeError(ctx, 'The port must be between 1 and 65535.')
  const resolved = await resolveTarget(ctx, config.hostname, { port: config.port })
  if (!resolved.ok) return resolved.result
  const hostname = validateHostname(config.hostname)
  const name = hostname.ok ? hostname.hostname : config.hostname
  const address = preferIPv4(resolved.addresses)[0]!
  const started = ctx.deps.clock()
  let peer: TlsPeer
  try {
    peer = await ctx.deps.tlsHandshake({ address, port: config.port, servername: isIpLiteral(name) ? null : name, hostname: name, signal: ctx.signal })
  } catch (error) {
    return down(ctx, describeNetworkError(error, { timeoutMs: ctx.timeoutMs, hostname: name }), { details: { address, port: config.port, resolved_ips: resolved.addresses } })
  }
  const latency = ctx.deps.clock() - started
  const details: Record<string, unknown> = {
    address,
    port: config.port,
    resolved_ips: resolved.addresses,
    subject: peer.subject,
    issuer: peer.issuer,
    valid_from: peer.validFrom?.toISOString() ?? null,
    valid_to: peer.validTo?.toISOString() ?? null,
    authorized: peer.authorized,
    protocol: peer.protocol,
  }
  if (!peer.validTo) return down(ctx, 'The server did not present a certificate.', { latency, details })
  const now = ctx.deps.now()
  details.days_left = Math.floor((peer.validTo.getTime() - now.getTime()) / 86_400_000)
  const expiry = evaluateTlsExpiry(peer.validTo, now, config.warn_days)
  // An expired certificate says more than "untrusted chain", so expiry is checked first.
  if (expiry.status === 'down') return down(ctx, expiry.error ?? 'The certificate has expired.', { latency, tlsExpiresAt: peer.validTo, details })
  if (!peer.authorized) {
    return down(ctx, describeTlsAuthorizationError(peer.authorizationError, name), { latency, tlsExpiresAt: peer.validTo, details: { ...details, authorization_error: peer.authorizationError } })
  }
  return build(ctx, expiry.status, { latency, error: expiry.error, tlsExpiresAt: peer.validTo, details })
}

/** Runs one check within request.timeout_ms and always resolves with a ProbeResult. */
export async function runCheck(request: ProbeRequest, region: string, deps: ProbeDeps): Promise<ProbeResult> {
  return await withTimeout(request.timeout_ms, async (signal) => {
    const ctx: CheckContext = { region, deps, signal, timeoutMs: request.timeout_ms, checkedAt: deps.now().toISOString() }
    const check = (() => {
      switch (request.type) {
        case 'http':
        case 'keyword':
          return checkHttp(ctx, request)
        case 'tcp':
          return checkTcp(ctx, request)
        case 'dns':
          return checkDns(ctx, request)
        case 'tls':
          return checkTls(ctx, request)
        default:
          return Promise.resolve(probeError(ctx, `Unknown monitor type ${String((request as { type: unknown }).type)}.`))
      }
    })()
    // Every network call observes the signal; the hard stop only guards against one that does not.
    let timer: ReturnType<typeof setTimeout> | undefined
    const hardStop = new Promise<ProbeResult>((resolve) => {
      timer = setTimeout(() => resolve(down(ctx, `Timed out after ${formatDuration(request.timeout_ms)}.`)), request.timeout_ms + HARD_STOP_GRACE_MS)
    })
    try {
      return await Promise.race([check, hardStop])
    } finally {
      clearTimeout(timer)
    }
  })
}
