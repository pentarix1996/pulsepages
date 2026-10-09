// Zod building blocks shared by every area. Route handlers (panel and /api/v1) validate with these, and the
// OpenAPI document is generated from them.
import { z } from 'zod'
import {
  COMPONENT_STATUSES,
  INCIDENT_COMPONENT_STATUSES,
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  MAINTENANCE_STATUSES,
  PROBLEM_STATUSES,
} from '@shared/domain.ts'

export const uuid = z.uuid({ error: 'Must be an id.' })
export const timestamp = z.iso.datetime({ offset: true, error: 'Use an ISO 8601 date-time, such as 2026-10-09T14:00:00Z.' })

export const componentStatus = z.enum(COMPONENT_STATUSES)
export const incidentComponentStatus = z.enum(INCIDENT_COMPONENT_STATUSES)
export const problemStatus = z.enum(PROBLEM_STATUSES)
export const incidentStatus = z.enum(INCIDENT_STATUSES)
export const incidentImpact = z.enum(INCIDENT_IMPACTS)
export const maintenanceStatus = z.enum(MAINTENANCE_STATUSES)

/** Lowercase key used by the API and Terraform to address an item. */
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Use lowercase letters, numbers and hyphens (max 63).')

export const name = (max = 80) => z.string().trim().min(1, 'Enter a name.').max(max, `Use at most ${max} characters.`)
export const optionalText = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`)

/** Accepts "", null or a value; empty strings become null. */
export function nullable<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? null : value), schema.nullable())
}

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color such as #0E7490.').transform((value) => value.toUpperCase())

export const httpsUrl = z
  .string()
  .trim()
  .max(2048, 'The URL is too long.')
  .pipe(z.url('Enter a full URL, starting with https://.'))
  .refine((value) => value.startsWith('https://'), 'Use an https:// URL.')

export const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.'))

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().describe('Items per page, 1-100 (default 50).'),
  cursor: z.string().optional().describe('Cursor from next_cursor of the previous page.'),
})
