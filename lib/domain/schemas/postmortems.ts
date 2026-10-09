// Postmortems: request validation and API resource (api.md "Incidents" → Postmortem).
import { z } from 'zod'
import { nullable, optionalText, timestamp, uuid } from './common'

export const POSTMORTEM_STATUSES = ['draft', 'published'] as const
export type PostmortemStatus = (typeof POSTMORTEM_STATUSES)[number]

const SECTION_MAX = 20000
const section = (label: string) => z.string().max(SECTION_MAX, `Keep the ${label} under ${SECTION_MAX} characters.`)

const linkUrl = z
  .string()
  .trim()
  .max(2048, 'The link is too long.')
  .pipe(z.url({ protocol: /^https?$/, error: 'Enter a full link, starting with https://.' }))

export const postmortemActionItemInput = z.object({
  id: z.string().trim().min(1).max(64).optional().describe('Kept when given; generated for new items.'),
  title: z.string().trim().min(1, 'Describe the action item.').max(300, 'Use at most 300 characters.'),
  owner: nullable(optionalText(120)).optional(),
  due_date: nullable(z.iso.date({ error: 'Use a date such as 2026-11-01.' })).optional(),
  done: z.boolean().default(false),
  url: nullable(linkUrl).optional().describe('Ticket or pull request.'),
})
export type PostmortemActionItemInput = z.infer<typeof postmortemActionItemInput>

export const postmortemTimelineEntryInput = z.object({
  at: timestamp,
  message: z.string().trim().min(1, 'Write what happened.').max(2000, 'Use at most 2000 characters.'),
  kind: z.string().trim().max(20).nullable().optional(),
  visibility: z.string().trim().max(20).nullable().optional(),
  status: z.string().trim().max(20).nullable().optional(),
})
export type PostmortemTimelineEntryInput = z.infer<typeof postmortemTimelineEntryInput>

/** Every field is optional; missing fields keep their value. Arrays replace the stored list. */
export const postmortemInput = z.object({
  title: z.string().trim().min(1, 'Give the postmortem a title.').max(200, 'Use at most 200 characters.').optional(),
  summary: section('summary').optional(),
  impact: section('impact').optional(),
  root_cause: section('root cause').optional(),
  resolution: section('resolution').optional(),
  lessons: section('lessons').optional(),
  action_items: z.array(postmortemActionItemInput).max(100, 'Use at most 100 action items.').optional(),
  timeline: z.array(postmortemTimelineEntryInput).max(500, 'Use at most 500 timeline entries.').optional(),
})
export type PostmortemInput = z.infer<typeof postmortemInput>

// ---------------------------------------------------------------- responses
export const postmortemActionItemResource = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.string().nullable(),
  due_date: z.string().nullable().describe('YYYY-MM-DD'),
  done: z.boolean(),
  url: z.string().nullable(),
})
export type PostmortemActionItemResource = z.infer<typeof postmortemActionItemResource>

export const postmortemTimelineEntryResource = z.object({
  at: timestamp,
  message: z.string(),
  kind: z.string().nullable(),
  visibility: z.string().nullable(),
  status: z.string().nullable(),
})
export type PostmortemTimelineEntryResource = z.infer<typeof postmortemTimelineEntryResource>

export const postmortemResource = z.object({
  id: uuid,
  incident_id: uuid,
  status: z.enum(POSTMORTEM_STATUSES),
  title: z.string(),
  summary: z.string(),
  impact: z.string(),
  root_cause: z.string(),
  resolution: z.string(),
  lessons: z.string(),
  action_items: z.array(postmortemActionItemResource),
  timeline: z.array(postmortemTimelineEntryResource),
  published_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
})
export type PostmortemResource = z.infer<typeof postmortemResource>
