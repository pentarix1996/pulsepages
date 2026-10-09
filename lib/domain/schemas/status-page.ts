// Status page extras: access links for private pages, custom domain verification, logo upload, and the helpers the
// settings form uses before it saves through PATCH /api/app/projects/{id} (owned by the projects area).
import { z } from 'zod'
import { parseIPv4, parseIPv6 } from '@shared/monitoring/ssrf.ts'
import { THEMES } from '@shared/domain.ts'
import { name, timestamp, uuid } from './common'

// ------------------------------------------------------------------ access links
export const accessTokenCreateInput = z.object({
  name: name(80).describe('Who the link is for, such as "Acme support team".'),
  expires_at: timestamp.nullable().optional().describe('When the link stops working. Null or omitted: never.'),
})
export type AccessTokenCreateInput = z.infer<typeof accessTokenCreateInput>

export const ACCESS_TOKEN_STATUSES = ['active', 'expired', 'revoked'] as const

export const accessTokenResource = z.object({
  id: uuid,
  name: z.string(),
  prefix: z.string().describe('First characters of the token, to recognise it.'),
  status: z.enum(ACCESS_TOKEN_STATUSES),
  created_at: timestamp,
  expires_at: timestamp.nullable(),
  revoked_at: timestamp.nullable(),
  last_used_at: timestamp.nullable(),
})
export type AccessTokenResource = z.infer<typeof accessTokenResource>

export interface AccessTokenCreated {
  token: AccessTokenResource
  /** The token itself, shown once. */
  secret: string
  /** Status page URL that carries the token (?access_token=…). */
  url: string
}

// ------------------------------------------------------------------ custom domain
export const CUSTOM_DOMAIN_STATUSES = ['none', 'pending', 'verified', 'error', 'suspended'] as const
export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number]

/** Same rule as the projects_custom_domain_check constraint. */
export const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export const customDomainInput = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, ''))
    .pipe(z.string().max(253, 'The domain is too long.').regex(DOMAIN_PATTERN, 'Enter a domain such as status.example.com, without https://.'))
    .nullable()
    .describe('Domain that serves the status page, such as status.example.com. Null removes it.'),
})
export type CustomDomainInput = z.infer<typeof customDomainInput>

export interface DnsRecordInstruction {
  type: 'CNAME' | 'TXT' | 'A'
  name: string
  value: string
  purpose: string
}

export interface CustomDomainState {
  domain: string | null
  status: CustomDomainStatus
  error: string | null
  verified_at: string | null
  /** Hostname the CNAME record must point to. */
  target: string
  records: DnsRecordInstruction[]
}

// ------------------------------------------------------------------ project (status page settings), api.md "Project"
export const projectSettingsResource = z.object({
  id: uuid,
  organization_id: uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(['public', 'private']),
  status_page_url: z.string(),
  custom_domain: z.string().nullable(),
  custom_domain_status: z.enum(CUSTOM_DOMAIN_STATUSES),
  custom_domain_verified_at: timestamp.nullable(),
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
export type ProjectSettingsResource = z.infer<typeof projectSettingsResource>

// ------------------------------------------------------------------ logo
export const LOGO_MAX_BYTES = 1024 * 1024
export const LOGO_CONTENT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
} as const
export type LogoContentType = keyof typeof LOGO_CONTENT_TYPES

export interface LogoUploadResult {
  url: string
  path: string
  content_type: LogoContentType
  size: number
}

// ------------------------------------------------------------------ settings form helpers (isomorphic)

/** Normalises one allow-list entry to CIDR notation (a single address gets /32 or /128). Null when invalid. */
export function normalizeCidr(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  const [address, prefix, ...rest] = value.split('/')
  if (rest.length > 0 || !address) return null
  if (prefix !== undefined && !/^\d{1,3}$/.test(prefix)) return null
  if (parseIPv4(address) !== null) {
    const bits = prefix === undefined ? 32 : Number(prefix)
    return bits <= 32 ? `${address}/${bits}` : null
  }
  if (address.includes(':') && parseIPv6(address) !== null) {
    const bits = prefix === undefined ? 128 : Number(prefix)
    return bits <= 128 ? `${address}/${bits}` : null
  }
  return null
}

/** Parses the IP allow-list textarea: one entry per line (commas and spaces also separate); # starts a comment. */
export function parseAllowList(text: string): { values: string[]; errors: Array<{ line: number; value: string }> } {
  const values: string[] = []
  const errors: Array<{ line: number; value: string }> = []
  text.split('\n').forEach((line, index) => {
    const content = line.replace(/#.*$/, '')
    for (const entry of content.split(/[\s,]+/).filter(Boolean)) {
      const normalized = normalizeCidr(entry)
      if (normalized) {
        if (!values.includes(normalized)) values.push(normalized)
      } else {
        errors.push({ line: index + 1, value: entry })
      }
    }
  })
  return { values, errors }
}

export const DEFAULT_UPTIME_WEIGHTS = { major_outage: 1, partial_outage: 0.3, degraded: 0 } as const

/** Reads projects.uptime_weights with the same defaults as SQL status_weight(). */
export function readUptimeWeights(value: unknown): { major_outage: number; partial_outage: number; degraded: number } {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const pick = (key: keyof typeof DEFAULT_UPTIME_WEIGHTS) => {
    const number = Number(source[key])
    return Number.isFinite(number) && source[key] !== null && source[key] !== undefined ? Math.min(1, Math.max(0, number)) : DEFAULT_UPTIME_WEIGHTS[key]
  }
  return { major_outage: pick('major_outage'), partial_outage: pick('partial_outage'), degraded: pick('degraded') }
}
