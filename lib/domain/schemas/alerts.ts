// Alert routing: channels, routing rules, the master switch and the event log (spec §6, api.md "Alerts").
import { z } from 'zod'
import { ALERT_CHANNEL_TYPES, ALERT_EVENT_TYPES, DELIVERY_STATUSES, ROUTABLE_EVENT_TYPES } from '@shared/domain.ts'
import { email, listQuery, name, problemStatus, timestamp, uuid } from './common'

/** Email channels hold at most this many recipients. */
export const MAX_RECIPIENTS = 20
/** A confirmation email can be sent again to the same address after this many minutes. */
export const RECIPIENT_RESEND_MINUTES = 10
/** Test alerts per status page in TEST_WINDOW_MINUTES. */
export const TEST_ALERTS_PER_WINDOW = 5
export const TEST_WINDOW_MINUTES = 10

export const alertChannelType = z.enum(ALERT_CHANNEL_TYPES)
export const routableEventType = z.enum(ROUTABLE_EVENT_TYPES)

// ------------------------------------------------------------------ settings
export const alertSettingsInput = z.object({
  enabled: z.boolean().optional().describe('Master switch. When off, events are logged as suppressed and nothing is sent; test alerts still go out.'),
  mute_during_maintenance: z
    .boolean()
    .optional()
    .describe('Mute component and monitor alerts while every affected component is in a maintenance window that mutes alerts.'),
})
export type AlertSettingsInput = z.infer<typeof alertSettingsInput>

export const alertSettingsResource = z.object({
  enabled: z.boolean(),
  mute_during_maintenance: z.boolean(),
})
export type AlertSettingsResource = z.infer<typeof alertSettingsResource>

// ------------------------------------------------------------------ channels
/** Write-only secrets. Which keys apply depends on the channel type; they are encrypted and never returned. */
export const alertChannelSecretInput = z
  .object({
    webhook_url: z.string().trim().max(2048, 'The URL is too long.').optional().describe('Slack, Microsoft Teams and Discord: the incoming webhook URL.'),
    url: z.string().trim().max(2048, 'The URL is too long.').optional().describe('Webhook: the https endpoint that receives events.'),
    signing_secret: z
      .string()
      .trim()
      .min(16, 'Use at least 16 characters.')
      .max(256, 'Use at most 256 characters.')
      .nullable()
      .optional()
      .describe('Webhook: secret for the Upvane-Signature HMAC header. Null removes it; omit it to keep the current one.'),
    routing_key: z.string().trim().max(64).optional().describe('PagerDuty: the Events API v2 integration (routing) key.'),
    api_key: z.string().trim().max(64).optional().describe('Opsgenie: the API integration key.'),
  })
  .strict()
export type AlertChannelSecretInput = z.infer<typeof alertChannelSecretInput>

export const alertChannelConfigInput = z
  .object({
    region: z.enum(['us', 'eu']).optional().describe('Opsgenie: the API region of your account.'),
  })
  .strict()

const channelWriteFields = {
  name: name(80),
  enabled: z.boolean().optional(),
  config: alertChannelConfigInput.optional(),
  secret: alertChannelSecretInput.optional(),
  generate_signing_secret: z
    .boolean()
    .optional()
    .describe('Webhook: generate a new whsec_ signing secret. It is returned once, as signing_secret, in this response.'),
  recipients: z
    .array(email)
    .max(MAX_RECIPIENTS, `Add at most ${MAX_RECIPIENTS} recipients.`)
    .optional()
    .describe('Email: the full list of recipients (replaces the current list). Organization members are confirmed right away; anyone else gets a confirmation email.'),
}

export const alertChannelCreateInput = z.object({ type: alertChannelType, ...channelWriteFields })
export type AlertChannelCreateInput = z.infer<typeof alertChannelCreateInput>

export const alertChannelUpdateInput = z.object({
  type: alertChannelType.optional().describe('Accepted for convenience; a channel cannot change type.'),
  ...channelWriteFields,
  name: name(80).optional(),
})
export type AlertChannelUpdateInput = z.infer<typeof alertChannelUpdateInput>

export const resendVerificationInput = z.object({ email })
export type ResendVerificationInput = z.infer<typeof resendVerificationInput>

export const alertRecipientResource = z.object({
  email: z.string(),
  verified: z.boolean(),
  verified_at: timestamp.nullable(),
  verification_sent_at: timestamp.nullable().describe('When the last confirmation email went out (null: not sent).'),
})
export type AlertRecipientResource = z.infer<typeof alertRecipientResource>

export const deliveryStatus = z.enum(DELIVERY_STATUSES)

export const alertChannelResource = z.object({
  id: uuid,
  type: alertChannelType,
  name: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).describe('Non-secret settings: opsgenie { region }, webhook { signed }.'),
  secret_hint: z.string().nullable().describe('A reminder of the secret (host and last characters). The secret itself is never returned.'),
  recipients: z.array(alertRecipientResource).optional().describe('Email channels only.'),
  last_delivery: z
    .object({ status: deliveryStatus, error_message: z.string().nullable(), at: timestamp })
    .nullable()
    .describe('Most recent delivery through this channel.'),
  signing_secret: z.string().optional().describe('Only present in the response that generated it.'),
  created_at: timestamp,
  updated_at: timestamp,
})
export type AlertChannelResource = z.infer<typeof alertChannelResource>

export const alertTestResult = z.object({
  event_id: uuid,
  deliveries: z.number().int().describe('Deliveries queued for the test alert.'),
  suppression_reason: z.string().nullable(),
})
export type AlertTestResult = z.infer<typeof alertTestResult>

// ------------------------------------------------------------------ rules
export const alertRuleCreateInput = z.object({
  name: name(80),
  enabled: z.boolean().optional(),
  event_types: z
    .array(routableEventType)
    .min(1, 'Choose at least one event.')
    .max(ROUTABLE_EVENT_TYPES.length)
    .describe('Events this rule sends.'),
  component_ids: z.array(uuid).max(500).optional().describe('Only events about these components. Empty: every component.'),
  monitor_ids: z.array(uuid).max(500).optional().describe('Only events from these monitors. Empty: every monitor.'),
  min_status: problemStatus.nullable().optional().describe('Only problems at least this bad. Recoveries always pass.'),
  channel_ids: z.array(uuid).max(50).optional().describe('Channels that receive the matching events.'),
  cooldown_minutes: z
    .number()
    .int()
    .min(0, 'Use 0 to 1440 minutes.')
    .max(1440, 'Use 0 to 1440 minutes.')
    .optional()
    .describe('Anti-flap window per component or monitor: repeats that are not worse are held back; recoveries go out once.'),
  position: z.number().int().min(0).max(100000).optional().describe('Order in the list (rules are evaluated top to bottom).'),
})
export type AlertRuleCreateInput = z.infer<typeof alertRuleCreateInput>

export const alertRuleUpdateInput = alertRuleCreateInput.partial()
export type AlertRuleUpdateInput = z.infer<typeof alertRuleUpdateInput>

export const alertRuleReorderInput = z.object({
  rule_ids: z.array(uuid).min(1).max(500).describe('Every rule of the status page, in the new order.'),
})
export type AlertRuleReorderInput = z.infer<typeof alertRuleReorderInput>

export const alertRuleResource = z.object({
  id: uuid,
  name: z.string(),
  enabled: z.boolean(),
  event_types: z.array(z.string()),
  component_ids: z.array(uuid),
  monitor_ids: z.array(uuid),
  min_status: problemStatus.nullable(),
  channel_ids: z.array(uuid),
  cooldown_minutes: z.number().int(),
  position: z.number().int(),
  created_at: timestamp,
  updated_at: timestamp,
})
export type AlertRuleResource = z.infer<typeof alertRuleResource>

// ------------------------------------------------------------------ event log
export const ALERT_EVENT_STATUS_FILTERS = ['pending', 'processed', 'suppressed', 'failed'] as const
export type AlertEventStatusFilter = (typeof ALERT_EVENT_STATUS_FILTERS)[number]

export const alertEventsQuery = listQuery.extend({
  type: z.enum(ALERT_EVENT_TYPES).optional().describe('Only events of this type.'),
  status: z
    .enum(ALERT_EVENT_STATUS_FILTERS)
    .optional()
    .describe('pending, processed (sent), suppressed, or failed (at least one delivery failed).'),
})
export type AlertEventsQuery = z.infer<typeof alertEventsQuery>

export const alertDeliveryResource = z.object({
  id: uuid,
  channel_id: uuid.nullable(),
  rule_id: uuid.nullable(),
  target: z.string().describe('Recipient email, or the channel name for chat, webhook and paging channels.'),
  target_type: z.string(),
  status: deliveryStatus,
  attempts: z.number().int(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  next_retry_at: timestamp.nullable(),
  sent_at: timestamp.nullable(),
  created_at: timestamp,
})
export type AlertDeliveryResource = z.infer<typeof alertDeliveryResource>

export const alertEventResource = z.object({
  id: uuid,
  type: z.string(),
  title: z.string().describe('Readable summary, as it appears in the alert.'),
  status: z.enum(['pending', 'processed', 'suppressed', 'failed']),
  suppression_reason: z.string().nullable().describe('cooldown, maintenance, alerts_disabled, no_matching_rule or no_verified_targets.'),
  source_type: z.string(),
  created_at: timestamp,
  processed_at: timestamp.nullable(),
  deliveries: z.array(alertDeliveryResource),
})
export type AlertEventResource = z.infer<typeof alertEventResource>

/** Why an event produced no deliveries, in words (alert_events.suppression_reason). */
export const SUPPRESSION_REASON_TEXT: Record<string, string> = {
  cooldown: 'Held back by the cooldown: this rule already alerted about the same component or monitor and this is not worse, or it is a recovery for a problem that was never announced.',
  maintenance: 'Muted: every affected component is in a maintenance window that mutes alerts.',
  alerts_disabled: 'Not sent: alerts are switched off for this status page.',
  no_matching_rule: 'Not sent: no enabled rule listens to this event for these components or monitors.',
  no_verified_targets: 'Not sent: the matching rules have no enabled channel with a confirmed recipient.',
  no_subscribers: 'Not sent: no confirmed subscriber follows these components.',
}

export function suppressionText(reason: string | null | undefined): string | null {
  if (!reason) return null
  return SUPPRESSION_REASON_TEXT[reason] ?? `Not sent (${reason.replace(/_/g, ' ')}).`
}
