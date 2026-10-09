// Status page subscribers managed by the team (spec §7, api.md "Subscribers"). The public subscribe form,
// confirmation and unsubscribe pages belong to the status page.
import { z } from 'zod'
import { SUBSCRIBER_TYPES } from '@shared/domain.ts'
import { email, listQuery, timestamp, uuid } from './common'

export const subscriberType = z.enum(SUBSCRIBER_TYPES)

const componentIds = z.array(uuid).max(500).optional().describe('Only updates about these components. Empty: everything.')

export const subscriberCreateInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    email,
    component_ids: componentIds,
  }),
  z.object({
    type: z.literal('slack'),
    webhook_url: z.string().trim().min(1, 'Paste the Slack webhook URL.').max(2048, 'The URL is too long.').describe('Slack incoming webhook URL (https://hooks.slack.com/services/…).'),
    component_ids: componentIds,
  }),
  z.object({
    type: z.literal('webhook'),
    url: z.string().trim().min(1, 'Enter the URL that should receive updates.').max(2048, 'The URL is too long.').describe('Public https endpoint that receives JSON updates.'),
    signing_secret: z.string().trim().min(16, 'Use at least 16 characters.').max(256).optional().describe('Secret for the Upvane-Signature HMAC header.'),
    generate_signing_secret: z.boolean().optional().describe('Generate a whsec_ signing secret, returned once as signing_secret.'),
    component_ids: componentIds,
  }),
])
export type SubscriberCreateInput = z.infer<typeof subscriberCreateInput>

export const SUBSCRIBER_STATUS_FILTERS = ['confirmed', 'pending'] as const

export const subscriberListQuery = listQuery.extend({
  type: subscriberType.optional().describe('Only subscribers of this type.'),
  status: z.enum(SUBSCRIBER_STATUS_FILTERS).optional().describe('confirmed, or pending (waiting for the email confirmation).'),
  component: uuid.optional().describe('Only subscribers that follow this component.'),
  q: z.string().trim().max(100).optional().describe('Search the email address or target.'),
})
export type SubscriberListQuery = z.infer<typeof subscriberListQuery>

export const subscriberResource = z.object({
  id: uuid,
  type: subscriberType,
  email: z.string().nullable(),
  target_hint: z.string().nullable().describe('Reminder of the Slack or webhook URL; the URL itself is encrypted and never returned.'),
  component_ids: z.array(uuid),
  confirmed: z.boolean(),
  confirmed_at: timestamp.nullable(),
  last_notified_at: timestamp.nullable(),
  created_at: timestamp,
  signing_secret: z.string().optional().describe('Only in the response that generated it.'),
})
export type SubscriberResource = z.infer<typeof subscriberResource>

export const SUBSCRIBE_OUTCOMES = ['confirmation_sent', 'already_confirmed', 'subscribed'] as const
export type SubscribeOutcome = (typeof SUBSCRIBE_OUTCOMES)[number]

export interface SubscriberAddResult {
  subscriber: SubscriberResource
  outcome: SubscribeOutcome
  /** Email subscribers: whether the confirmation email went out (null for other types). */
  email_sent: boolean | null
}

export interface SubscriberCounts {
  total: number
  confirmed: number
  pending: number
  email: number
  slack: number
  webhook: number
  /** Plan limit per status page (-1: unlimited). */
  limit: number
}
