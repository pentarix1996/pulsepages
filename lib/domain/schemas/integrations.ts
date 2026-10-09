// Inbound integrations (external alerts → component status): write bodies and API resources (api.md).
import { z } from 'zod'
import { INBOUND_INTEGRATION_TYPES } from '@shared/domain.ts'
import { name, nullable, problemStatus, timestamp, uuid } from './common'

const labelKey = z
  .string()
  .trim()
  .min(1, 'Enter a label name.')
  .max(100, 'Label names can have at most 100 characters.')
  .regex(/^[^=,\r\n\t]+$/, 'Label names cannot contain =, commas or line breaks.')

export const labelMatch = z
  .record(labelKey, z.string().trim().min(1, 'Enter the label value.').max(500, 'Use at most 500 characters.'))
  .refine((match) => Object.keys(match).length >= 1, 'Match at least one label, such as service=payments.')
  .refine((match) => Object.keys(match).length <= 20, 'Match at most 20 labels.')
  .describe('Labels the alert must have, all of them (case-insensitive), such as { "service": "payments" }.')

export const mappingInput = z.object({
  match: labelMatch,
  component_id: z.string().trim().min(1, 'Choose a component.').describe('Component id or key.'),
  status: problemStatus.nullable().optional().describe('Status while the alert fires. Default: from the severity label, else the default status.'),
})
export type MappingInput = z.infer<typeof mappingInput>

export const integrationCreateInput = z.object({
  type: z.enum(INBOUND_INTEGRATION_TYPES, { error: `Choose a type: ${INBOUND_INTEGRATION_TYPES.join(', ')}.` }),
  name: name(80),
  enabled: z.boolean().optional(),
  default_component_id: nullable(z.string().trim().min(1)).optional().describe('Component id or key for alerts no mapping or component label matches.'),
  default_status: problemStatus.optional().describe('Status when neither a mapping nor the severity sets one (default partial_outage).'),
  auto_draft_incident: z.boolean().optional().describe('Open a draft incident when an alert sets a partial or major outage (default false).'),
  mappings: z.array(mappingInput).max(100, 'Use at most 100 mappings.').optional().describe('Checked in order; the first match wins.'),
})
export type IntegrationCreateInput = z.infer<typeof integrationCreateInput>

export const integrationUpdateInput = integrationCreateInput.partial()
export type IntegrationUpdateInput = z.infer<typeof integrationUpdateInput>

// ---------------------------------------------------------------- responses
export const integrationMappingResource = z.object({
  match: z.record(z.string(), z.string()),
  component_id: uuid,
  status: problemStatus.nullable(),
})

export const integrationResource = z.object({
  id: uuid,
  type: z.enum(INBOUND_INTEGRATION_TYPES),
  name: z.string(),
  enabled: z.boolean(),
  url: z.string().describe('Endpoint to configure in the provider. It contains the secret token.'),
  default_component_id: uuid.nullable(),
  default_status: problemStatus,
  auto_draft_incident: z.boolean(),
  mappings: z.array(integrationMappingResource),
  last_received_at: timestamp.nullable(),
  received_count: z.number().int(),
  last_error: z.string().nullable().describe('Why the last payload was rejected, or why its alerts matched no component.'),
  active_signals: z.number().int().describe('Alerts from this integration that are firing now.'),
  created_at: timestamp,
  updated_at: timestamp,
})
export type IntegrationResource = z.infer<typeof integrationResource>
export type IntegrationMappingResource = z.infer<typeof integrationMappingResource>

export const inboundResultResource = z.object({
  upserted: z.number().int().describe('Firing alerts recorded.'),
  resolved: z.number().int().describe('Resolved alerts recorded.'),
  unmatched: z.number().int().describe('Alerts that matched no component (add a mapping or a default component).'),
  subscription_confirmed: z.boolean().optional().describe('CloudWatch: the SNS subscription was confirmed.'),
})
export type InboundResult = z.infer<typeof inboundResultResource>
