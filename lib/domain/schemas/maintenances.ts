// Maintenance windows: request validation and API resources (api.md "Maintenance windows").
import { z } from 'zod'
import { listQuery, maintenanceStatus, timestamp, uuid } from './common'
import { actorResource } from './incidents'

export const MAINTENANCE_LIST_FILTERS = ['upcoming', 'active', 'past', 'all'] as const
export type MaintenanceListFilter = (typeof MAINTENANCE_LIST_FILTERS)[number]

export const maintenanceListQuery = listQuery.extend({
  status: z
    .enum(MAINTENANCE_LIST_FILTERS)
    .default('all')
    .describe('upcoming (scheduled, soonest first), active (in progress), past (completed or cancelled, newest first) or all (newest first).'),
})
export type MaintenanceListQuery = z.infer<typeof maintenanceListQuery>

export const MAX_MAINTENANCE_COMPONENTS = 100
const componentRefs = z
  .array(z.string().trim().min(1, 'Use a component id or key.').max(100))
  .max(MAX_MAINTENANCE_COMPONENTS, `Use at most ${MAX_MAINTENANCE_COMPONENTS} components.`)

const title = z.string().trim().min(1, 'Give the window a title.').max(200, 'Use at most 200 characters.')
const description = z.string().trim().max(5000, 'Use at most 5000 characters.')
const reminderMinutes = z.number().int().min(0, 'Use 0 to 10080 minutes.').max(10080, 'Use 0 to 10080 minutes (one week).')
const WINDOW_ORDER = { message: 'The window must end after it starts.', path: ['scheduled_end'] }

function endsAfterStart(value: { scheduled_start?: string; scheduled_end?: string }): boolean {
  if (!value.scheduled_start || !value.scheduled_end) return true
  return Date.parse(value.scheduled_end) > Date.parse(value.scheduled_start)
}

export const maintenanceCreateInput = z
  .object({
    title,
    description: description.default('').describe('What changes and what customers may notice.'),
    scheduled_start: timestamp,
    scheduled_end: timestamp,
    components: componentRefs.default([]).describe('Ids or keys of the components under maintenance.'),
    auto_start: z.boolean().default(true).describe('Start at scheduled_start.'),
    auto_complete: z.boolean().default(true).describe('Complete at scheduled_end.'),
    notify_subscribers: z.boolean().default(true),
    reminder_minutes: reminderMinutes.default(1440).describe('Remind subscribers this many minutes before it starts (0 = no reminder).'),
    mute_alerts: z.boolean().default(true).describe('Mute alerts for the affected components while it is in progress.'),
  })
  .refine(endsAfterStart, WINDOW_ORDER)
export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateInput>

/** Every field optional; components replaces the list. Only while the window is scheduled or in progress. */
export const maintenancePatchInput = z
  .object({
    title: title.optional(),
    description: description.optional(),
    scheduled_start: timestamp.optional(),
    scheduled_end: timestamp.optional(),
    components: componentRefs.optional(),
    auto_start: z.boolean().optional(),
    auto_complete: z.boolean().optional(),
    notify_subscribers: z.boolean().optional(),
    reminder_minutes: reminderMinutes.optional(),
    mute_alerts: z.boolean().optional(),
  })
  .refine(endsAfterStart, WINDOW_ORDER)
export type MaintenancePatchInput = z.infer<typeof maintenancePatchInput>

export const maintenanceActionInput = z.object({
  message: description.optional().describe('Update shown on the status page. A default message is used when empty.'),
})
export type MaintenanceActionInput = z.infer<typeof maintenanceActionInput>

export const maintenanceUpdateInput = z.object({
  message: z.string().trim().min(1, 'Write a message for the update.').max(5000, 'Use at most 5000 characters.'),
})
export type MaintenanceUpdateInput = z.infer<typeof maintenanceUpdateInput>

// ---------------------------------------------------------------- responses
export const maintenanceUpdateResource = z.object({
  id: uuid,
  status: maintenanceStatus.nullable(),
  message: z.string(),
  actor: actorResource,
  created_at: timestamp,
})
export type MaintenanceUpdateResource = z.infer<typeof maintenanceUpdateResource>

export const maintenanceResource = z.object({
  id: uuid,
  project_id: uuid,
  title: z.string(),
  description: z.string(),
  status: maintenanceStatus,
  scheduled_start: timestamp,
  scheduled_end: timestamp,
  actual_start: timestamp.nullable(),
  actual_end: timestamp.nullable(),
  components: z.array(z.object({ component_id: uuid, slug: z.string(), name: z.string() })),
  auto_start: z.boolean(),
  auto_complete: z.boolean(),
  notify_subscribers: z.boolean(),
  reminder_minutes: z.number().int(),
  mute_alerts: z.boolean(),
  url: z.string().describe('Public permalink.'),
  created_at: timestamp,
  updated_at: timestamp,
  updates: z.array(maintenanceUpdateResource).optional().describe('Newest first. Only when getting one window.'),
})
export type MaintenanceResource = z.infer<typeof maintenanceResource>
