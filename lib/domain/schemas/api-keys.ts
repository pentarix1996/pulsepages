import { z } from 'zod'
import { API_KEY_SCOPES } from '@shared/domain.ts'
import { PLANS } from '@shared/plans.ts'
import { name, nullable, timestamp, uuid } from './common'

export const API_KEY_ACCESS = ['read', 'write'] as const
export type ApiKeyAccess = (typeof API_KEY_ACCESS)[number]

export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const

/** How long a rotated key keeps working, so deploys can pick up the new one. */
export const ROTATION_GRACE_PERIODS = ['1h', '24h', '7d'] as const
export type RotationGrace = (typeof ROTATION_GRACE_PERIODS)[number]

export const apiKeyCreateInput = z.object({
  organization_id: uuid,
  name: name(60),
  /** read → scopes ["read"]; write → scopes ["read", "write"]. */
  access: z.enum(API_KEY_ACCESS).default('read'),
  /** Null: every status page of the organization. */
  project_id: nullable(uuid).optional(),
  expires_in_days: z
    .union([z.literal(30), z.literal(90), z.literal(365)], { error: 'Choose 30, 90 or 365 days, or no expiry.' })
    .nullable()
    .default(null),
})
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateInput>

export const apiKeyRotateInput = z.object({
  grace: z.enum(ROTATION_GRACE_PERIODS).default('24h'),
})
export type ApiKeyRotateInput = z.infer<typeof apiKeyRotateInput>

export const API_KEY_STATUSES = ['active', 'expired', 'revoked'] as const
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number]

export const apiKeyResource = z.object({
  id: uuid,
  name: z.string(),
  /** First characters of the key (upv_live_XXXX), safe to show. */
  prefix: z.string().nullable(),
  scopes: z.array(z.enum(API_KEY_SCOPES)),
  project: z.object({ id: uuid, name: z.string() }).nullable(),
  created_by: z.object({ id: uuid, name: z.string() }).nullable(),
  created_at: timestamp,
  last_used_at: timestamp.nullable(),
  expires_at: timestamp.nullable(),
  revoked_at: timestamp.nullable(),
  status: z.enum(API_KEY_STATUSES),
})
export type ApiKeyResource = z.infer<typeof apiKeyResource>

/** GET /api/v1/me */
export const meResource = z.object({
  key: z.object({
    id: uuid,
    name: z.string(),
    prefix: z.string().nullable().describe('First characters of the key, safe to log.'),
    scopes: z.array(z.enum(API_KEY_SCOPES)),
    project_id: uuid.nullable().describe('Status page the key is limited to, or null for every page of the organization.'),
  }),
  organization: z.object({
    id: uuid,
    slug: z.string(),
    name: z.string(),
    plan: z.enum(PLANS),
  }),
})
export type MeResource = z.infer<typeof meResource>
