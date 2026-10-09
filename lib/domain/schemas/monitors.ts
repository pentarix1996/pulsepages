// Monitors: write bodies (a discriminated union on `type`), query strings and API resources (api.md "Monitors").
// The probe reads the stored config with the defaults in @shared/monitoring/config.ts; these schemas only decide
// what may be stored. DNS-based SSRF checks run in lib/domain/monitors.ts when a monitor is saved.
import { z } from 'zod'
import { CHECK_RESULT_STATUSES, DNS_RECORD_TYPES, HTTP_METHODS, MONITOR_STATES, MONITOR_TYPES, type MonitorType } from '@shared/domain.ts'
import { MONITOR_DEFAULTS } from '@shared/monitoring/config.ts'
import { validateHostname, validateMonitorUrl } from '@shared/monitoring/ssrf.ts'
import { ASSERTION_OPERATORS, ASSERTION_SOURCES } from '@shared/monitoring/types.ts'
import { PROBE_REGION_IDS } from '@shared/regions.ts'
import { listQuery, name, nullable, problemStatus, timestamp, uuid } from './common'

// ------------------------------------------------------------------ building blocks
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,100}$/
/** Hop-by-hop and framing headers the probe sets itself. */
const RESERVED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-connection'])

export const headerName = z
  .string()
  .trim()
  .min(1, 'Enter a header name.')
  .max(100, 'Header names can have at most 100 characters.')
  .regex(HEADER_NAME, 'Header names use letters, numbers and dashes, such as X-Api-Version.')
  .refine((value) => !RESERVED_HEADERS.has(value.toLowerCase()), 'Upvane sets this header itself.')

const headerValue = z
  .string()
  .max(4096, 'Header values can have at most 4096 characters.')
  .refine((value) => !/[\r\n\0]/.test(value), 'Header values cannot contain line breaks.')

export const headerInput = z.object({ name: headerName, value: headerValue })
export type HeaderInput = z.infer<typeof headerInput>

export const secretHeaderInput = z.object({
  name: headerName,
  value: headerValue
    .refine((value) => value.trim() !== '', 'Enter a value.')
    .nullable()
    .describe('Secret value. Send null to keep the value already saved for this header.'),
})
export type SecretHeaderInput = z.infer<typeof secretHeaderInput>

/** 200, "2xx" or "200-299"; three-digit strings become numbers and ranges are normalised. */
export const statusCodePattern = z
  .union([
    z.number({ error: 'Use a status code such as 200.' }).int().min(100, 'Status codes go from 100 to 599.').max(599, 'Status codes go from 100 to 599.'),
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(\d{3}|[1-5]xx|\d{3}\s*-\s*\d{3})$/, 'Use a code (200), a class (2xx) or a range (200-299).'),
  ])
  .superRefine((value, ctx) => {
    if (typeof value !== 'string') return
    const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(value)
    const codes = range ? [Number(range[1]), Number(range[2])] : /^\d{3}$/.test(value) ? [Number(value)] : []
    if (codes.some((code) => code < 100 || code > 599)) ctx.addIssue({ code: 'custom', message: 'Status codes go from 100 to 599.' })
    if (range && codes[0]! > codes[1]!) ctx.addIssue({ code: 'custom', message: 'Start the range with the lower code, such as 200-299.' })
  })
  .transform((value): number | string => {
    if (typeof value === 'number') return value
    if (/^\d{3}$/.test(value)) return Number(value)
    return value.replace(/\s+/g, '')
  })

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
}

const NUMERIC_OPERATORS = new Set(['greater_than', 'less_than', 'greater_or_equal', 'less_or_equal'])
const VALUELESS_OPERATORS = new Set(['exists', 'not_exists'])

export const assertionInput = z
  .object({
    source: z.enum(ASSERTION_SOURCES).describe('What to check: status_code, header, json (a JSON path in the body), body or response_time (ms).'),
    path: nullable(z.string().trim().max(300, 'Use at most 300 characters.')).optional().describe('Header name for header, JSON path such as data.status or items[0].ok for json.'),
    operator: z.enum(ASSERTION_OPERATORS),
    value: z.union([z.string().max(1000, 'Use at most 1000 characters.'), z.number(), z.boolean()]).nullable().optional(),
    on_fail: z.enum(['down', 'degraded']).default('down').describe('What a failure means (default down).'),
  })
  .superRefine((assertion, ctx) => {
    if (assertion.source === 'header') {
      if (!assertion.path) ctx.addIssue({ code: 'custom', path: ['path'], message: 'Enter the header name.' })
      else if (!HEADER_NAME.test(assertion.path)) ctx.addIssue({ code: 'custom', path: ['path'], message: 'Header names use letters, numbers and dashes.' })
    }
    if (VALUELESS_OPERATORS.has(assertion.operator)) {
      if (assertion.source === 'status_code' || assertion.source === 'response_time') {
        ctx.addIssue({ code: 'custom', path: ['operator'], message: 'Compare the status code and the response time with a value.' })
      }
      return
    }
    const missing = assertion.value === undefined || (typeof assertion.value === 'string' && assertion.value.trim() === '')
    if (missing || (assertion.value === null && assertion.operator !== 'equals' && assertion.operator !== 'not_equals')) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a value to compare with.' })
      return
    }
    if ((NUMERIC_OPERATORS.has(assertion.operator) || assertion.source === 'status_code' || assertion.source === 'response_time') && !isNumeric(assertion.value)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Use a number with this comparison.' })
    }
  })
  .transform((assertion) => {
    const keepsPath = assertion.source === 'header' || assertion.source === 'json'
    const numeric = assertion.source === 'status_code' || assertion.source === 'response_time' || NUMERIC_OPERATORS.has(assertion.operator)
    return {
      source: assertion.source,
      path: keepsPath ? assertion.path || (assertion.source === 'json' ? '$' : null) : null,
      operator: assertion.operator,
      value: VALUELESS_OPERATORS.has(assertion.operator) ? null : numeric && isNumeric(assertion.value) ? Number(assertion.value) : assertion.value ?? null,
      on_fail: assertion.on_fail,
    }
  })
export type AssertionInput = z.infer<typeof assertionInput>

const monitorUrl = z
  .string({ error: 'Enter a URL.' })
  .trim()
  .min(1, 'Enter a URL.')
  .max(2048, 'The URL is too long.')
  .superRefine((value, ctx) => {
    const result = validateMonitorUrl(value)
    if (!result.ok) ctx.addIssue({ code: 'custom', message: result.reason })
  })
  .transform((value) => {
    const result = validateMonitorUrl(value)
    return result.ok && result.url ? result.url : value
  })

const hostname = z
  .string({ error: 'Enter a hostname.' })
  .trim()
  .min(1, 'Enter a hostname.')
  .max(253, 'The hostname is too long.')
  .superRefine((value, ctx) => {
    if (/[/:]/.test(value.replace(/^\[.*\]$/, ''))) {
      ctx.addIssue({ code: 'custom', message: 'Enter only the hostname, such as api.example.com (no scheme, port or path).' })
      return
    }
    const result = validateHostname(value)
    if (!result.ok) ctx.addIssue({ code: 'custom', message: result.reason })
  })
  .transform((value) => {
    const result = validateHostname(value)
    return result.ok ? result.hostname : value
  })

const portNumber = z.number({ error: 'Enter a port number.' }).int('Enter a whole number.').min(1, 'Ports go from 1 to 65535.').max(65535, 'Ports go from 1 to 65535.')

const latencyThreshold = z
  .number()
  .int()
  .min(1, 'Use at least 1 ms.')
  .max(60_000, 'Use at most 60000 ms.')
  .nullable()
  .optional()
  .describe('Responses slower than this mark the check as degraded.')

// ------------------------------------------------------------------ configs by type
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

const httpShape = {
  url: monitorUrl.describe('https:// URL. Private, local and reserved addresses are rejected.'),
  method: z.enum(HTTP_METHODS).default('GET'),
  headers: z.array(headerInput).max(20, 'Use at most 20 headers.').default([]).describe('Plain headers, stored and shown as typed. Use secret_headers for credentials.'),
  body: nullable(z.string().max(10_000, 'The body can have at most 10000 characters.')).optional(),
  expected_status_codes: z.array(statusCodePattern).max(20, 'Use at most 20 patterns.').optional().describe('Codes, classes or ranges such as 200, "2xx" or "200-299". Default 200-399.'),
  follow_redirects: z.boolean().default(true).describe(`Follow up to ${MONITOR_DEFAULTS.max_redirects} redirects; every hop is re-checked against private addresses.`),
  assertions: z.array(assertionInput).max(20, 'Use at most 20 assertions.').default([]).describe('Checked in order; the worst failure wins.'),
  latency_threshold_ms: latencyThreshold,
}

function checkHttp(config: { method: string; body?: string | null; headers: HeaderInput[] }, ctx: z.RefinementCtx): void {
  if (config.body && !BODY_METHODS.has(config.method)) {
    ctx.addIssue({ code: 'custom', path: ['body'], message: `${config.method} requests cannot send a body. Use POST, PUT, PATCH, DELETE or OPTIONS.` })
  }
  const seen = new Set<string>()
  config.headers.forEach((header, index) => {
    const key = header.name.toLowerCase()
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['headers', index, 'name'], message: `${header.name} is set twice.` })
    seen.add(key)
  })
}

export const httpConfigInput = z.object(httpShape).superRefine(checkHttp)

export const keywordConfigInput = z
  .object({
    ...httpShape,
    keyword: z.string({ error: 'Enter the keyword to look for.' }).min(1, 'Enter the keyword to look for.').max(500, 'Use at most 500 characters.'),
    keyword_mode: z.enum(['contains', 'not_contains']).default('contains'),
    case_sensitive: z.boolean().default(false),
  })
  .superRefine((config, ctx) => {
    checkHttp(config, ctx)
    if (config.method === 'HEAD') ctx.addIssue({ code: 'custom', path: ['method'], message: 'HEAD responses have no body. Use GET to look for a keyword.' })
  })

export const tcpConfigInput = z.object({
  host: hostname,
  port: portNumber,
  latency_threshold_ms: latencyThreshold,
})

export const dnsConfigInput = z.object({
  hostname,
  record_type: z.enum(DNS_RECORD_TYPES).default('A'),
  expected_values: z.array(z.string().trim().min(1, 'Remove empty values.').max(500, 'Use at most 500 characters.')).max(20, 'Use at most 20 values.').default([]).describe('Values the answer must include. Empty means any answer is fine.'),
  match: z.enum(['any', 'all']).default('any').describe('any: one expected value is enough; all: every expected value must be present.'),
})

export const tlsConfigInput = z.object({
  hostname,
  port: portNumber.default(443),
  warn_days: z.number().int().min(1, 'Use at least 1 day.').max(365, 'Use at most 365 days.').default(MONITOR_DEFAULTS.tls_warn_days).describe('Days before expiry that turn the check degraded and send a warning.'),
})

export const heartbeatConfigInput = z.object({
  grace_seconds: z.number().int().min(0, 'Use 0 seconds or more.').max(86_400, 'Use at most one day (86400 seconds).').default(MONITOR_DEFAULTS.heartbeat_grace_seconds).describe('Extra time after the expected interval before the monitor goes down.'),
})

export const MONITOR_CONFIG_SCHEMAS = {
  http: httpConfigInput,
  keyword: keywordConfigInput,
  tcp: tcpConfigInput,
  dns: dnsConfigInput,
  tls: tlsConfigInput,
  heartbeat: heartbeatConfigInput,
} as const satisfies Record<MonitorType, z.ZodType>

export type HttpConfig = z.infer<typeof httpConfigInput>
export type KeywordConfig = z.infer<typeof keywordConfigInput>
export type TcpConfig = z.infer<typeof tcpConfigInput>
export type DnsConfig = z.infer<typeof dnsConfigInput>
export type TlsConfig = z.infer<typeof tlsConfigInput>
export type HeartbeatConfig = z.infer<typeof heartbeatConfigInput>
export type MonitorConfigInput = HttpConfig | KeywordConfig | TcpConfig | DnsConfig | TlsConfig | HeartbeatConfig

// ------------------------------------------------------------------ write bodies
export const probeRegion = z.enum(PROBE_REGION_IDS as [string, ...string[]], { error: `Use probe regions such as ${PROBE_REGION_IDS.slice(0, 3).join(', ')}.` })

const commonFields = {
  name: name(120),
  enabled: z.boolean().optional().describe('Check right away (default true). False pauses the monitor.'),
  interval_seconds: z.number().int().min(30, 'Check at most every 30 seconds.').max(86_400, 'Check at least once a day.').optional().describe('Seconds between checks (heartbeats: expected time between pings). The plan sets the minimum.'),
  timeout_ms: z.number().int().min(1000, 'Use at least 1000 ms.').max(30_000, 'Use at most 30000 ms.').optional(),
  regions: z.array(probeRegion).min(1, 'Choose at least one region.').max(PROBE_REGION_IDS.length).optional().describe('Probe regions. The plan sets how many; TLS and heartbeat monitors use one.'),
  confirm_failures: z.number().int().min(1).max(10).optional().describe('Failed checks in a row before a region confirms a problem (default 2).'),
  confirm_regions: z.number().int().min(1).max(15).optional().describe('Regions that must confirm a problem before the monitor changes state (default 1).'),
  recovery_successes: z.number().int().min(1).max(10).optional().describe('Passing checks in a row before a region confirms recovery (default 2).'),
  failure_status: problemStatus.optional().describe('Status linked components get while the monitor is down (default major_outage).'),
  degraded_status: problemStatus.optional().describe('Status linked components get while the monitor is degraded (default degraded).'),
  auto_draft_incident: z.boolean().optional().describe('Open a draft incident when the monitor goes down (default true).'),
  components: z.array(z.string().trim().min(1)).max(50).optional().describe('Ids or keys of the components this monitor sets. Replaces the current links.'),
  secret_headers: z
    .array(secretHeaderInput)
    .max(20, 'Use at most 20 secret headers.')
    .nullable()
    .optional()
    .describe('Write-only, encrypted headers (credentials). Replaces the set; value null keeps the saved value of that header; null removes them all.'),
}

const typeOption = <T extends MonitorType, C extends z.ZodType>(type: T, config: C) => z.object({ type: z.literal(type), ...commonFields, config })

export const monitorCreateInput = z.discriminatedUnion(
  'type',
  [
    typeOption('http', httpConfigInput),
    typeOption('keyword', keywordConfigInput),
    typeOption('tcp', tcpConfigInput),
    typeOption('dns', dnsConfigInput),
    typeOption('tls', tlsConfigInput),
    typeOption('heartbeat', heartbeatConfigInput.prefault({})),
  ],
  { error: `Choose a monitor type: ${MONITOR_TYPES.join(', ')}.` },
)
export type MonitorCreateInput = z.infer<typeof monitorCreateInput>

export const monitorUpdateInput = z.object({
  type: z.enum(MONITOR_TYPES).optional().describe('Change between http, keyword, tcp, dns and tls (send the new config too). Heartbeat monitors keep their type.'),
  ...commonFields,
  name: name(120).optional(),
  config: z.record(z.string(), z.unknown()).optional().describe('Replaces the whole config. Same shape as on create for the monitor type.'),
})
export type MonitorUpdateInput = z.infer<typeof monitorUpdateInput>

export const monitorEnabledInput = z.object({ enabled: z.boolean() })

// ------------------------------------------------------------------ query strings
function csvOf<T extends readonly [string, ...string[]]>(values: T, label: string) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((raw) => (Array.isArray(raw) ? raw : [raw]).flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values, { error: `Use ${label}: ${values.join(', ')}.` })))
}

export const monitorListQuery = listQuery.extend({
  state: csvOf(MONITOR_STATES, 'states').optional().describe('Comma-separated states, such as down,degraded.'),
  type: csvOf(MONITOR_TYPES, 'types').optional().describe('Comma-separated types, such as http,tcp.'),
  search: z.string().trim().max(120).optional().describe('Part of the name.'),
})
export type MonitorListQuery = z.infer<typeof monitorListQuery>

export const RESULT_STATUS_FILTERS = ['up', 'degraded', 'down', 'error'] as const
export const monitorResultsQuery = listQuery.extend({
  region: z.string().trim().max(40).optional().describe('Probe region, such as eu-central-1 (heartbeat pings use "heartbeat").'),
  status: z.enum(RESULT_STATUS_FILTERS).optional(),
})
export type MonitorResultsQuery = z.infer<typeof monitorResultsQuery>

// ------------------------------------------------------------------ responses
export const monitorComponentRef = z.object({ component_id: uuid, slug: z.string(), name: z.string() })

const configOutput = z.union([
  httpConfigInput,
  keywordConfigInput,
  tcpConfigInput,
  dnsConfigInput,
  tlsConfigInput,
  heartbeatConfigInput,
])

export const monitorResource = z.object({
  id: uuid,
  project_id: uuid,
  name: z.string(),
  type: z.enum(MONITOR_TYPES),
  enabled: z.boolean(),
  paused_reason: z.string().nullable().describe('plan_limit when Upvane paused it because the plan does not cover it.'),
  interval_seconds: z.number().int(),
  timeout_ms: z.number().int(),
  regions: z.array(z.string()),
  confirm_failures: z.number().int(),
  confirm_regions: z.number().int(),
  recovery_successes: z.number().int(),
  config: configOutput.describe('Type-specific settings, as on create.'),
  secret_header_names: z.array(z.string()).describe('Names of the encrypted headers. Values are never returned.'),
  failure_status: problemStatus,
  degraded_status: problemStatus,
  auto_draft_incident: z.boolean(),
  components: z.array(monitorComponentRef),
  state: z.enum(MONITOR_STATES),
  state_changed_at: timestamp.nullable(),
  last_checked_at: timestamp.nullable(),
  last_result: z.record(z.string(), z.unknown()).nullable(),
  last_error: z.string().nullable(),
  tls_expires_at: timestamp.nullable(),
  last_heartbeat_at: timestamp.nullable(),
  heartbeat_url: z.string().nullable().describe('Ping URL of heartbeat monitors (admins and write keys only; null otherwise).'),
  created_at: timestamp,
  updated_at: timestamp,
})
export type MonitorResource = z.infer<typeof monitorResource>
export type MonitorComponentRef = z.infer<typeof monitorComponentRef>

export const checkResultResource = z.object({
  id: uuid,
  region: z.string().nullable(),
  status: z.enum(CHECK_RESULT_STATUSES).describe('error means the probe itself failed; it never counts against the monitor.'),
  http_status: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  error: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  checked_at: timestamp,
})
export type CheckResultResource = z.infer<typeof checkResultResource>

export const probeResultResource = z.object({
  region: z.string(),
  status: z.enum(CHECK_RESULT_STATUSES),
  latency_ms: z.number().nullable(),
  http_status: z.number().int().nullable().optional(),
  error: z.string().nullable().optional(),
  checked_at: z.string(),
  tls_expires_at: z.string().nullable().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type ProbeResultResource = z.infer<typeof probeResultResource>

export const monitorRunResource = z.object({
  state: z.enum(MONITOR_STATES).nullable().describe('Monitor state after the run.'),
  results: z.array(probeResultResource),
})
export type MonitorRunResource = z.infer<typeof monitorRunResource>

export const heartbeatResultResource = z.object({ state: z.enum(MONITOR_STATES) })
export const heartbeatFailInput = z.object({ message: z.string().max(500).optional().describe('What went wrong (shown on the monitor and in alerts).') })
