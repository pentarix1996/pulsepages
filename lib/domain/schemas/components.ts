import { z } from 'zod'
import { STATUS_SOURCES } from '@shared/domain.ts'
import { componentStatus, name, nullable, optionalText, problemStatus, slug, timestamp, uuid } from './common'

export const dependencyInput = z.object({
  component: z.string().trim().min(1).describe('Id or key of the component this one depends on.'),
  impact: problemStatus.default('partial_outage').describe('Status this component gets when the dependency has a major outage.'),
})

export const componentCreateInput = z.object({
  name: name(80),
  slug: slug.optional().describe('Stable key for the API and Terraform. Generated from the name when omitted.'),
  description: nullable(optionalText(500)).optional(),
  group_id: nullable(uuid).optional(),
  position: z.number().int().min(0).max(100000).optional(),
  depends_on: z.array(dependencyInput).max(50).optional(),
  /** Deprecated (v0 API): an initial status becomes a manual pin. */
  status: componentStatus.optional().describe('Deprecated. Pins a manual status; use PUT /status instead.'),
})
export type ComponentCreateInput = z.infer<typeof componentCreateInput>

export const componentUpdateInput = z.object({
  name: name(80).optional(),
  slug: slug.optional(),
  description: nullable(optionalText(500)).optional(),
  group_id: nullable(uuid).optional(),
  position: z.number().int().min(0).max(100000).optional(),
  /** Deprecated (v0 API): pins a manual status. */
  status: componentStatus.optional().describe('Deprecated. Pins a manual status; use PUT /status instead.'),
})
export type ComponentUpdateInput = z.infer<typeof componentUpdateInput>

export const manualStatusInput = z.object({
  status: componentStatus.nullable().describe('Status to pin, or null to return to automatic status.'),
})
export type ManualStatusInput = z.infer<typeof manualStatusInput>

export const dependenciesInput = z.object({
  depends_on: z.array(dependencyInput).max(50),
})
export type DependenciesInput = z.infer<typeof dependenciesInput>

export const reorderInput = z.object({
  groups: z.array(z.object({ id: uuid, position: z.number().int().min(0) })).max(500).default([]),
  components: z.array(z.object({ id: uuid, group_id: uuid.nullable(), position: z.number().int().min(0) })).max(2000),
})
export type ReorderInput = z.infer<typeof reorderInput>

export const groupCreateInput = z.object({
  name: name(80),
  position: z.number().int().min(0).max(100000).optional(),
  collapsed: z.boolean().optional(),
})
export const groupUpdateInput = groupCreateInput.partial()
export type GroupCreateInput = z.infer<typeof groupCreateInput>
export type GroupUpdateInput = z.infer<typeof groupUpdateInput>

// ---------------------------------------------------------------- responses
export const componentResource = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: componentStatus.describe('Effective status shown on the status page.'),
  status_source: z.enum(STATUS_SOURCES).describe('What decided the current status.'),
  manual_status: componentStatus.nullable().describe('Pinned status, or null when automatic.'),
  automated_status: componentStatus.nullable().describe('Status from monitors and external alerts.'),
  group_id: uuid.nullable(),
  position: z.number().int(),
  depends_on: z.array(z.object({ component_id: uuid, impact: problemStatus })),
  status_changed_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
})
export type ComponentResource = z.infer<typeof componentResource>

export const componentGroupResource = z.object({
  id: uuid,
  name: z.string(),
  position: z.number().int(),
  collapsed: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
})
export type ComponentGroupResource = z.infer<typeof componentGroupResource>
