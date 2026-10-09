// Status pages (projects): input validation, normalization helpers and API resources. Pure and isomorphic: the
// "New status page" dialog uses the slug helpers for its preview, the routes validate with the schemas.
import { z } from 'zod'
import { THEMES } from '@shared/domain.ts'
import { componentStatus, hexColor, incidentImpact, incidentStatus, maintenanceStatus, name, nullable, optionalText, timestamp, uuid } from './common'

// ------------------------------------------------------------------ slugs
/** Same rule as SQL enforce_project_limits(): 2-64 characters, starts and ends with a letter or number. */
export const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

export const projectSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(PROJECT_SLUG_PATTERN, 'Use 2-64 lowercase letters, numbers and hyphens, starting and ending with a letter or number.')

/** "Quillbase Status (EU)" → "quillbase-status-eu". Always returns a valid slug. */
export function slugifyProjectName(value: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  if (base.length >= 2) return base
  return base ? `${base}-status` : 'status'
}

/** First free slug: `base`, then `base-2`, `base-3`… (kept within 64 characters). */
export function uniqueProjectSlug(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((slug) => slug.toLowerCase()))
  if (!used.has(base)) return base
  for (let n = 2; n < 10_000; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, 55)}-${Date.now().toString(36)}`
}

// ------------------------------------------------------------------ time zones
const UTC_ALIASES = /^(utc|etc\/utc|etc\/uct|uct|gmt|etc\/gmt|etc\/greenwich|greenwich|universal|etc\/universal|zulu|etc\/zulu)$/i
const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

let knownZones: Map<string, string> | null = null
function zoneByLowercase(value: string): string | undefined {
  if (!knownZones) {
    knownZones = new Map()
    try {
      for (const zone of Intl.supportedValuesOf('timeZone')) knownZones.set(zone.toLowerCase(), zone)
    } catch {
      // Older runtimes without Intl.supportedValuesOf: fall back to resolvedOptions() below.
    }
  }
  return knownZones.get(value.toLowerCase())
}

/**
 * Returns the IANA time zone to store, or null when it is not one. Offsets such as "+01:00" are rejected on purpose:
 * Postgres reads them as POSIX zones with the sign inverted. Case is fixed ("europe/madrid" → "Europe/Madrid").
 */
export function normalizeTimeZone(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 64 || !ZONE_SHAPE.test(trimmed)) return null
  if (UTC_ALIASES.test(trimmed)) return 'UTC'
  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone
  } catch {
    return null
  }
  const known = zoneByLowercase(trimmed)
  if (known) return known
  return trimmed === trimmed.toLowerCase() ? resolved : trimmed
}

export const timeZone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const zone = normalizeTimeZone(value)
    if (!zone) {
      ctx.addIssue({ code: 'custom', message: 'Use an IANA time zone such as Europe/Madrid or America/New_York.' })
      return z.NEVER
    }
    return zone
  })
  .describe('IANA time zone, e.g. Europe/Madrid.')

// ------------------------------------------------------------------ IP allow-list
function parseIPv4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

function parseIPv6(text: string): number[] | null {
  const value = text.toLowerCase()
  if (!/^[0-9a-f:.]+$/.test(value)) return null
  let body = value
  let tail: number[] = []
  if (value.includes('.')) {
    // Embedded IPv4 in the last 32 bits: ::ffff:192.0.2.1, 64:ff9b::198.51.100.7
    const lastColon = value.lastIndexOf(':')
    if (lastColon === -1) return null
    const v4 = parseIPv4(value.slice(lastColon + 1))
    if (!v4) return null
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!]
    body = value.slice(0, lastColon + 1)
    if (!body.endsWith('::')) body = body.slice(0, -1)
  }
  const halves = body.split('::')
  if (halves.length > 2) return null
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return []
    const result: number[] = []
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null
      result.push(parseInt(group, 16))
    }
    return result
  }
  const head = parseGroups(halves[0]!)
  const rest = halves.length === 2 ? parseGroups(halves[1]!) : []
  if (!head || !rest) return null
  const explicit = head.length + rest.length + tail.length
  if (halves.length === 2) {
    if (explicit > 7) return null
    return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest, ...tail]
  }
  if (explicit !== 8) return null
  return [...head, ...tail]
}

/** RFC 5952 text form: lowercase, no leading zeros, longest run of two or more zero groups compressed. */
export function formatIPv6(groups: number[]): string {
  let bestStart = -1
  let bestLength = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLength && j - i >= 2) {
      bestStart = i
      bestLength = j - i
    }
    i = j
  }
  const hex = groups.map((group) => group.toString(16))
  if (bestStart === -1) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`
}

/** Keeps the first `prefix` bits of an address split in units of `bitsPerUnit` bits (8 for IPv4, 16 for IPv6). */
function clearHostBits(units: number[], bitsPerUnit: number, prefix: number): number[] {
  return units.map((unit, index) => {
    const keep = Math.max(0, Math.min(bitsPerUnit, prefix - index * bitsPerUnit))
    if (keep === bitsPerUnit) return unit
    const mask = keep === 0 ? 0 : ((1 << keep) - 1) << (bitsPerUnit - keep)
    return unit & mask
  })
}

export type AllowedIpResult = { ok: true; value: string } | { ok: false; error: string }

/**
 * Validates one allow-list entry: an IPv4/IPv6 address or a CIDR block. Returns the canonical text
 * ("203.0.113.0/24", "2001:db8::/32", single addresses without /32 or /128).
 */
export function parseAllowedIp(input: string): AllowedIpResult {
  const text = input.trim()
  if (!text) return { ok: false, error: 'Enter an IP address or a CIDR block.' }
  const slash = text.indexOf('/')
  if (slash !== text.lastIndexOf('/')) return { ok: false, error: `${text} is not a valid IP address or CIDR block.` }
  const address = slash === -1 ? text : text.slice(0, slash)
  const prefixText = slash === -1 ? null : text.slice(slash + 1)
  const v4 = parseIPv4(address)
  const v6 = v4 ? null : parseIPv6(address)
  if (!v4 && !v6) return { ok: false, error: `${text} is not a valid IP address or CIDR block.` }
  const maxPrefix = v4 ? 32 : 128
  let prefix = maxPrefix
  if (prefixText !== null) {
    if (!/^(0|[1-9]\d{0,2})$/.test(prefixText) || Number(prefixText) > maxPrefix) {
      return { ok: false, error: `${text} has an invalid prefix length. Use /0 to /${maxPrefix}.` }
    }
    prefix = Number(prefixText)
  }
  const units = v4 ?? v6!
  const bits = v4 ? 8 : 16
  const format = (values: number[]) => (v4 ? values.join('.') : formatIPv6(values))
  const network = clearHostBits(units, bits, prefix)
  if (network.some((unit, index) => unit !== units[index])) {
    return { ok: false, error: `${text} has host bits set. Did you mean ${format(network)}/${prefix}?` }
  }
  return { ok: true, value: prefix === maxPrefix ? format(units) : `${format(units)}/${prefix}` }
}

const allowedIp = z.string().transform((value, ctx) => {
  const parsed = parseAllowedIp(value)
  if (!parsed.ok) {
    ctx.addIssue({ code: 'custom', message: parsed.error })
    return z.NEVER
  }
  return parsed.value
})

export const allowedIps = z
  .array(allowedIp)
  .max(200, 'Use at most 200 entries.')
  .transform((values) => [...new Set(values)])
  .describe('IPv4/IPv6 addresses or CIDR blocks allowed to open a private page. Empty means no IP restriction.')

// ------------------------------------------------------------------ custom domain
/** Same rule as the projects_custom_domain_check constraint. */
export const CUSTOM_DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Accepts what people paste: "https://Status.Example.com/" → "status.example.com". */
export function normalizeHostname(value: string): string {
  let host = value.trim().toLowerCase()
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = host.split(/[/?#]/)[0] ?? ''
  return host.replace(/\.+$/, '')
}

export const customDomain = z
  .preprocess(
    (value) => (typeof value === 'string' ? normalizeHostname(value) || null : value),
    z.string().max(253, 'The domain is too long.').regex(CUSTOM_DOMAIN_PATTERN, 'Enter a domain you own, such as status.example.com.').nullable(),
  )
  .describe('Lowercase hostname that serves the page (CNAME to Upvane). null removes it. Changing it restarts verification.')

// ------------------------------------------------------------------ other settings
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export const supportUrl = z
  .string()
  .trim()
  .max(2048, 'The URL is too long.')
  .refine((value) => (/^mailto:/i.test(value) ? /^mailto:[^\s@/]+@[^\s@/]+\.[^\s@/]+$/i.test(value) : isHttpsUrl(value)), 'Use an https:// URL or a mailto: address.')

/** https, or http on localhost for logos uploaded to a local Supabase storage. */
export const logoUrl = z
  .string()
  .trim()
  .max(2048, 'The URL is too long.')
  .refine((value) => isHttpsUrl(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(value), 'Use an https:// URL for the logo.')

export const uptimeWeights = z
  .object({
    partial_outage: z.number().min(0, 'Use a weight between 0 and 1.').max(1, 'Use a weight between 0 and 1.'),
    degraded: z.number().min(0, 'Use a weight between 0 and 1.').max(1, 'Use a weight between 0 and 1.'),
  })
  .refine((weights) => weights.degraded <= weights.partial_outage, { message: 'Degraded cannot weigh more than a partial outage.', path: ['degraded'] })
  .describe('How much of each minute counts as downtime. Major outages always count fully; maintenance never counts.')

export const PROJECT_VISIBILITIES = ['public', 'private'] as const
export const CUSTOM_DOMAIN_STATUSES = ['none', 'pending', 'verified', 'error', 'suspended'] as const

const settingsShape = {
  description: nullable(optionalText(500)).optional(),
  visibility: z.enum(PROJECT_VISIBILITIES).optional().describe('Private pages need the Business plan.'),
  timezone: timeZone.optional(),
  support_url: nullable(supportUrl).optional(),
  theme_default: z.enum(THEMES).optional(),
  brand_color: nullable(hexColor).optional().describe('Pro plan and up.'),
  logo_url: nullable(logoUrl).optional().describe('Pro plan and up.'),
  hide_powered_by: z.boolean().optional().describe('Pro plan and up.'),
  auto_postmortem: z.boolean().optional().describe('Draft a postmortem when a major or critical incident is resolved.'),
  auto_draft_incidents: z.boolean().optional().describe('Let monitors open draft incidents.'),
  allowed_ips: allowedIps.optional(),
  custom_domain: customDomain.optional(),
  uptime_weights: uptimeWeights.optional(),
}

export const projectCreateInput = z.object({
  organization_id: uuid.optional().describe('Organization for the new page. Required in the dashboard; API keys always use their own organization.'),
  name: name(80),
  slug: projectSlug.optional().describe('Part of the public URL. Generated from the name when omitted.'),
  ...settingsShape,
})
export type ProjectCreateInput = z.infer<typeof projectCreateInput>

export const projectUpdateInput = z.object({
  name: name(80).optional(),
  slug: projectSlug.optional().describe('Changing it changes the public URL.'),
  ...settingsShape,
})
export type ProjectUpdateInput = z.infer<typeof projectUpdateInput>

// ------------------------------------------------------------------ responses
export const projectResource = z.object({
  id: uuid,
  organization_id: uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(PROJECT_VISIBILITIES),
  status_page_url: z.string().describe('Public URL; uses the custom domain once it is verified.'),
  custom_domain: z.string().nullable(),
  custom_domain_status: z.enum(CUSTOM_DOMAIN_STATUSES),
  custom_domain_error: z.string().nullable(),
  brand_color: z.string().nullable(),
  logo_url: z.string().nullable(),
  theme_default: z.enum(THEMES),
  timezone: z.string(),
  support_url: z.string().nullable(),
  hide_powered_by: z.boolean(),
  auto_postmortem: z.boolean(),
  auto_draft_incidents: z.boolean(),
  allowed_ips: z.array(z.string()),
  uptime_weights: z.object({ major_outage: z.number(), partial_outage: z.number(), degraded: z.number() }),
  created_at: timestamp,
  updated_at: timestamp,
})
export type ProjectResource = z.infer<typeof projectResource>

export const projectStatusResource = z.object({
  status: componentStatus.describe('Worst component status.'),
  headline: z.string().describe('Headline the status page shows for that status.'),
  components: z.array(z.object({ id: uuid, slug: z.string(), name: z.string(), status: componentStatus })),
  active_incidents: z.array(z.object({ id: uuid, title: z.string(), status: incidentStatus, impact: incidentImpact, url: z.string() })),
  maintenances: z.array(z.object({ id: uuid, title: z.string(), status: maintenanceStatus, scheduled_start: timestamp, scheduled_end: timestamp })),
})
export type ProjectStatusResource = z.infer<typeof projectStatusResource>
