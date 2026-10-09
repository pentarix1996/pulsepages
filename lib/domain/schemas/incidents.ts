// Incidents, incident updates and incident templates: request validation and API resources (api.md "Incidents").
import { z } from 'zod'
import { INCIDENT_SOURCES, INCIDENT_UPDATE_KINDS, UPDATE_VISIBILITIES } from '@shared/domain.ts'
import { componentStatus, incidentComponentStatus, incidentImpact, incidentStatus, listQuery, name, timestamp, uuid } from './common'

export const INCIDENT_LIST_FILTERS = ['active', 'draft', 'resolved', 'all'] as const
export type IncidentListFilter = (typeof INCIDENT_LIST_FILTERS)[number]

export const incidentListQuery = listQuery.extend({
  status: z
    .enum(INCIDENT_LIST_FILTERS)
    .default('all')
    .describe('active (investigating, identified or monitoring), draft, resolved or all. Newest first.'),
})
export type IncidentListQuery = z.infer<typeof incidentListQuery>

/** Stages a published incident can be in. Drafts become public through /publish. */
export const publicIncidentStatus = incidentStatus.exclude(['draft'])
export type PublicIncidentStatus = z.infer<typeof publicIncidentStatus>

/** v0 API severities (mapped to impact with SEVERITY_TO_IMPACT). */
export const LEGACY_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type LegacySeverity = (typeof LEGACY_SEVERITIES)[number]

/** Stages a template can open an incident in. */
export const TEMPLATE_STATUSES = ['investigating', 'identified', 'monitoring'] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

export const MAX_INCIDENT_COMPONENTS = 100
const componentRef = z.string().trim().min(1, 'Use a component id or key.').max(100)
const tooManyComponents = { message: `Use at most ${MAX_INCIDENT_COMPONENTS} components.` }

export const incidentTitle = z.string().trim().min(1, 'Give the incident a title.').max(200, 'Use at most 200 characters.')
export const incidentMessage = z.string().trim().max(5000, 'Use at most 5000 characters.')

/** `{ "<component id or key>": status }` for the components an incident affects. */
export const incidentComponentsInput = z
  .record(componentRef, incidentComponentStatus)
  .refine((value) => Object.keys(value).length <= MAX_INCIDENT_COMPONENTS, tooManyComponents)
  .describe('Status of each affected component, keyed by component id or key.')

/** Like incidentComponentsInput, but `null` takes a component out of the incident. */
export const incidentComponentChangesInput = z
  .record(componentRef, incidentComponentStatus.nullable())
  .refine((value) => Object.keys(value).length <= MAX_INCIDENT_COMPONENTS, tooManyComponents)
  .describe('Status changes keyed by component id or key. null removes the component from the incident.')

export const incidentCreateInput = z.object({
  title: incidentTitle.optional().describe('Required unless template_id provides one.'),
  message: incidentMessage.optional().describe('First update. Defaults to the template message, or "We are investigating this issue."'),
  status: incidentStatus
    .optional()
    .describe('investigating (default), identified, monitoring or resolved. draft prepares it without publishing or changing components.'),
  impact: incidentImpact.optional().describe('none, minor (default), major or critical.'),
  components: incidentComponentsInput.optional(),
  notify_subscribers: z.boolean().optional().describe('Email and notify status page subscribers (default true). Ignored for drafts.'),
  template_id: uuid.optional().describe('Incident template to start from. Fields you send override the template.'),
  severity: z.enum(LEGACY_SEVERITIES).optional().describe('Deprecated (v0). critical, high, medium or low; becomes impact.'),
  component_ids: z.array(componentRef).max(MAX_INCIDENT_COMPONENTS).optional().describe('Deprecated (v0). Affected components; their status follows severity.'),
  description: incidentMessage.optional().describe('Deprecated (v0). Same as message.'),
})
export type IncidentCreateInput = z.infer<typeof incidentCreateInput>

export const incidentPatchInput = z.object({
  title: incidentTitle.optional(),
  impact: incidentImpact.optional(),
})
export type IncidentPatchInput = z.infer<typeof incidentPatchInput>

/** v0 compatibility: PUT changed fields and turned a message (or a new status) into an update. */
export const incidentLegacyUpdateInput = z.object({
  title: incidentTitle.optional(),
  impact: incidentImpact.optional(),
  severity: z.enum(LEGACY_SEVERITIES).optional().describe('Deprecated (v0). Becomes impact.'),
  status: publicIncidentStatus.optional().describe('Posts a public update in this stage.'),
  message: incidentMessage.optional().describe('Posts a public update with this message.'),
  description: incidentMessage.optional().describe('Deprecated (v0). Same as message.'),
  component_ids: z.array(componentRef).max(MAX_INCIDENT_COMPONENTS).optional().describe('Deprecated (v0). Replaces the affected components.'),
  components: incidentComponentChangesInput.optional(),
  notify_subscribers: z.boolean().optional(),
})
export type IncidentLegacyUpdateInput = z.infer<typeof incidentLegacyUpdateInput>

export const incidentUpdateInput = z.object({
  message: z.string().trim().min(1, 'Write a message for the update.').max(5000, 'Use at most 5000 characters.'),
  status: publicIncidentStatus.optional().describe('Stage after this update; defaults to the current one. Ignored for internal notes.'),
  visibility: z.enum(UPDATE_VISIBILITIES).default('public').describe('public updates go to the status page; internal notes stay in the timeline.'),
  components: incidentComponentChangesInput.optional(),
  notify_subscribers: z.boolean().default(true).describe('Notify status page subscribers (public updates only).'),
})
export type IncidentUpdateInput = z.infer<typeof incidentUpdateInput>

export const incidentPublishInput = z.object({
  message: incidentMessage.optional().describe('First public update. Defaults to a message for the stage.'),
  status: publicIncidentStatus.default('investigating'),
  components: incidentComponentChangesInput.optional(),
  notify_subscribers: z.boolean().default(true),
})
export type IncidentPublishInput = z.infer<typeof incidentPublishInput>

// ---------------------------------------------------------------- templates
export const incidentTemplateCreateInput = z.object({
  name: name(80),
  title: incidentTitle,
  message: incidentMessage.default(''),
  impact: incidentImpact.default('minor'),
  status: z.enum(TEMPLATE_STATUSES).default('investigating'),
  component_statuses: incidentComponentsInput.default({}),
})
export type IncidentTemplateCreateInput = z.infer<typeof incidentTemplateCreateInput>

/** Written out instead of `.partial()`: in zod 4 defaults would still fill missing fields. */
export const incidentTemplateUpdateInput = z.object({
  name: name(80).optional(),
  title: incidentTitle.optional(),
  message: incidentMessage.optional(),
  impact: incidentImpact.optional(),
  status: z.enum(TEMPLATE_STATUSES).optional(),
  component_statuses: incidentComponentsInput.optional(),
})
export type IncidentTemplateUpdateInput = z.infer<typeof incidentTemplateUpdateInput>

// ---------------------------------------------------------------- responses
export const ACTOR_TYPES = ['user', 'api_key', 'system'] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

export const actorResource = z.object({
  type: z.enum(ACTOR_TYPES),
  label: z.string().describe('Person, API key or "Upvane" for automatic changes.'),
})
export type ActorResource = z.infer<typeof actorResource>

export const incidentUpdateResource = z.object({
  id: uuid,
  kind: z.enum(INCIDENT_UPDATE_KINDS).describe('update (stage change or progress), note (internal) or system (logged change).'),
  visibility: z.enum(UPDATE_VISIBILITIES),
  status: incidentStatus.nullable().describe('Stage of the incident when the update was posted.'),
  message: z.string(),
  component_statuses: z.record(z.string(), componentStatus).describe('Snapshot of every affected component, keyed by component id.'),
  notify_subscribers: z.boolean(),
  actor: actorResource,
  created_at: timestamp,
})
export type IncidentUpdateResource = z.infer<typeof incidentUpdateResource>

export const incidentComponentResource = z.object({
  component_id: uuid,
  slug: z.string(),
  name: z.string(),
  status: componentStatus.describe('Status this incident asserts for the component.'),
})
export type IncidentComponentResource = z.infer<typeof incidentComponentResource>

export const incidentResource = z.object({
  id: uuid,
  project_id: uuid,
  title: z.string(),
  status: incidentStatus,
  impact: incidentImpact,
  severity: z.enum(LEGACY_SEVERITIES).describe('Deprecated (v0). Derived from impact.'),
  source: z.enum(INCIDENT_SOURCES),
  components: z.array(incidentComponentResource),
  component_ids: z.array(uuid).describe('Deprecated (v0). Ids of the affected components.'),
  detected_at: timestamp,
  acknowledged_at: timestamp.nullable(),
  acknowledged_by: actorResource.nullable(),
  published_at: timestamp.nullable(),
  resolved_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
  url: z.string().nullable().describe('Public permalink. Null for drafts.'),
  postmortem: z.object({ id: uuid, status: z.enum(['draft', 'published']) }).nullable(),
  updates: z.array(incidentUpdateResource).optional().describe('Timeline, newest first. Only when getting one incident.'),
})
export type IncidentResource = z.infer<typeof incidentResource>

export const incidentTemplateResource = z.object({
  id: uuid,
  name: z.string(),
  title: z.string(),
  message: z.string(),
  impact: incidentImpact,
  status: z.enum(TEMPLATE_STATUSES),
  component_statuses: z.record(z.string(), componentStatus).describe('Keyed by component id or key, as written.'),
  created_at: timestamp,
  updated_at: timestamp,
})
export type IncidentTemplateResource = z.infer<typeof incidentTemplateResource>
