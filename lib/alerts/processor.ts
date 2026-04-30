import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALERT_DELIVERY_STATUS, ALERT_EVENT_STATUS, ALERT_EVENT_TYPE, type AlertChannelType, type StoredAlertDelivery, type StoredAlertEvent } from './types'
import { createAlertChannelRegistry, type AlertChannelRegistry } from './channels'
import { normalizeProjectAlertConfig } from './config'
import { resendEmailChannel } from './adapters/resend'

const MAX_EVENTS = 25
const MAX_ATTEMPTS = 5
const BACKOFF_MINUTES = [1, 5, 30, 120, 360] as const

interface AlertChannelConfigRow {
  id: string
  project_id: string
  type: AlertChannelType
  enabled: boolean
  config: unknown
}

interface AlertProjectConfigRow {
  enabled: boolean
  cooldown_minutes: number
  notify_recovery: boolean
  alert_types: unknown
}

interface ProcessAlertsResult {
  processedEvents: number
  sent: number
  retryable: number
  failed: number
  suppressed: number
  errors: string[]
}

interface AlertDeliveryClaimRow {
  id: string
}

export async function processPendingAlerts(registry: AlertChannelRegistry = defaultAlertChannelRegistry()): Promise<ProcessAlertsResult> {
  const supabase = createAdminClient()
  const result: ProcessAlertsResult = { processedEvents: 0, sent: 0, retryable: 0, failed: 0, suppressed: 0, errors: [] }
  const { data: events, error } = await supabase
    .from('alert_events')
    .select('*')
    .in('status', [ALERT_EVENT_STATUS.PENDING, ALERT_EVENT_STATUS.FAILED])
    .order('created_at', { ascending: true })
    .limit(MAX_EVENTS)

  if (error) return { ...result, errors: [error.message] }

  for (const rawEvent of events ?? []) {
    const event = rawEvent as StoredAlertEvent
    const eventResult = await processEvent(event, registry)
    result.processedEvents += 1
    result.sent += eventResult.sent
    result.retryable += eventResult.retryable
    result.failed += eventResult.failed
    result.suppressed += eventResult.suppressed
    result.errors.push(...eventResult.errors)
  }
  return result
}

export function defaultAlertChannelRegistry(): AlertChannelRegistry {
  return createAlertChannelRegistry([resendEmailChannel as never])
}

async function processEvent(event: StoredAlertEvent, registry: AlertChannelRegistry): Promise<Omit<ProcessAlertsResult, 'processedEvents'>> {
  const supabase = createAdminClient()
  const result: Omit<ProcessAlertsResult, 'processedEvents'> = { sent: 0, retryable: 0, failed: 0, suppressed: 0, errors: [] }
  const { data: projectConfigRow } = await supabase.from('project_alert_configs').select('*').eq('project_id', event.project_id).maybeSingle()
  const projectConfig = normalizeProjectAlertConfig(projectConfigRow ?? {})
  if (!projectConfig.enabled || shouldSuppressBySettings(event, projectConfigRow as AlertProjectConfigRow | null)) {
    await supabase.from('alert_events').update({ status: ALERT_EVENT_STATUS.SUPPRESSED, processed_at: new Date().toISOString() }).eq('id', event.id)
    return { ...result, suppressed: 1 }
  }

  await expandEventDeliveries(event, registry)

  const { data: deliveries, error } = await supabase
    .from('alert_deliveries')
    .select('*')
    .eq('event_id', event.id)
    .in('status', [ALERT_DELIVERY_STATUS.PENDING, ALERT_DELIVERY_STATUS.RETRYABLE])
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)

  if (error) return { ...result, errors: [error.message] }

  for (const rawDelivery of deliveries ?? []) {
    const delivery = rawDelivery as StoredAlertDelivery
    const deliveryResult = await processDelivery(event, delivery, projectConfig.cooldown_minutes, registry)
    result.sent += deliveryResult === ALERT_DELIVERY_STATUS.SENT ? 1 : 0
    result.retryable += deliveryResult === ALERT_DELIVERY_STATUS.RETRYABLE ? 1 : 0
    result.failed += deliveryResult === ALERT_DELIVERY_STATUS.FAILED ? 1 : 0
    result.suppressed += deliveryResult === ALERT_DELIVERY_STATUS.SUPPRESSED ? 1 : 0
  }

  await finalizeEvent(event.id)
  return result
}

async function expandEventDeliveries(event: StoredAlertEvent, registry: AlertChannelRegistry): Promise<void> {
  const supabase = createAdminClient()
  const { count } = await supabase.from('alert_deliveries').select('id', { count: 'exact', head: true }).eq('event_id', event.id)
  if ((count ?? 0) > 0) return

  const { data: channels } = await supabase.from('alert_channel_configs').select('*').eq('project_id', event.project_id).eq('enabled', true)
  const rows = []
  for (const channel of (channels ?? []) as AlertChannelConfigRow[]) {
    const adapter = registry.get(channel.type)
    if (!adapter) continue
    const config = adapter.validate(channel.config)
    for (const target of adapter.getTargets(config)) {
      rows.push({
        event_id: event.id,
        channel_config_id: channel.id,
        target,
        idempotency_key: `${event.id}:${channel.id}:${target}`,
      })
    }
  }
  if (rows.length > 0) await supabase.from('alert_deliveries').insert(rows)
}

async function processDelivery(event: StoredAlertEvent, delivery: StoredAlertDelivery, cooldownMinutes: number, registry: AlertChannelRegistry): Promise<StoredAlertDelivery['status']> {
  const supabase = createAdminClient()
  const { data: channel } = await supabase.from('alert_channel_configs').select('*').eq('id', delivery.channel_config_id).maybeSingle()
  if (!channel || channel.enabled !== true) return suppressDelivery(delivery.id)

  const adapter = registry.get(channel.type as AlertChannelType)
  if (!adapter) return suppressDelivery(delivery.id)

  if (await isCoolingDown(event, channel.type as AlertChannelType, cooldownMinutes)) return suppressDelivery(delivery.id)

  const claimed = await claimDeliveryForProcessing(delivery)
  if (!claimed) return delivery.status

  const config = adapter.validate(channel.config)
  const payload = adapter.render(event, config, delivery.target)
  const outcome = await adapter.deliver({ delivery, event, payload, idempotencyKey: delivery.idempotency_key })
  const terminalStatus = outcome.status === 'sent'
    ? ALERT_DELIVERY_STATUS.SENT
    : outcome.status === 'retryable' && delivery.attempts + 1 < MAX_ATTEMPTS
      ? ALERT_DELIVERY_STATUS.RETRYABLE
      : ALERT_DELIVERY_STATUS.FAILED
  const nextRetryAt = terminalStatus === ALERT_DELIVERY_STATUS.RETRYABLE ? nextRetryDate(delivery.attempts + 1).toISOString() : null

  await supabase.from('alert_deliveries').update({
    status: terminalStatus,
    provider: outcome.provider,
    provider_message_id: outcome.providerMessageId,
    error_code: outcome.errorCode,
    error_message: outcome.errorMessage,
    next_retry_at: nextRetryAt,
    sent_at: terminalStatus === ALERT_DELIVERY_STATUS.SENT ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', delivery.id)

  if (terminalStatus === ALERT_DELIVERY_STATUS.SENT) await upsertCooldown(event, channel.type as AlertChannelType)
  return terminalStatus
}

async function claimDeliveryForProcessing(delivery: StoredAlertDelivery): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('alert_deliveries')
    .update({ status: ALERT_DELIVERY_STATUS.PROCESSING, attempts: delivery.attempts + 1, updated_at: new Date().toISOString() })
    .eq('id', delivery.id)
    .in('status', [ALERT_DELIVERY_STATUS.PENDING, ALERT_DELIVERY_STATUS.RETRYABLE])
    .select('id')

  if (error) return false
  return isSingleClaimRow(data)
}

function isSingleClaimRow(value: unknown): value is [AlertDeliveryClaimRow] {
  return Array.isArray(value)
    && value.length === 1
    && typeof value[0] === 'object'
    && value[0] !== null
    && 'id' in value[0]
    && typeof value[0].id === 'string'
}

async function isCoolingDown(event: StoredAlertEvent, channelType: AlertChannelType, cooldownMinutes: number): Promise<boolean> {
  if (event.type === ALERT_EVENT_TYPE.TEST || cooldownMinutes === 0 || event.type === ALERT_EVENT_TYPE.COMPONENT_RECOVERED) return false
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('alert_cooldowns')
    .select('last_sent_at,last_event_id')
    .eq('project_id', event.project_id)
    .eq('channel_type', channelType)
    .eq('dedupe_key', event.dedupe_key)
    .maybeSingle()
  if (!data?.last_sent_at) return false
  if (data.last_event_id === event.id) return false
  return Date.now() - new Date(data.last_sent_at).getTime() < cooldownMinutes * 60_000
}

async function upsertCooldown(event: StoredAlertEvent, channelType: AlertChannelType): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('alert_cooldowns').upsert({
    project_id: event.project_id,
    channel_type: channelType,
    dedupe_key: event.dedupe_key,
    last_sent_at: new Date().toISOString(),
    last_event_id: event.id,
  }, { onConflict: 'project_id,channel_type,dedupe_key' })
}

async function suppressDelivery(deliveryId: string): Promise<StoredAlertDelivery['status']> {
  const supabase = createAdminClient()
  await supabase.from('alert_deliveries').update({ status: ALERT_DELIVERY_STATUS.SUPPRESSED, updated_at: new Date().toISOString() }).eq('id', deliveryId)
  return ALERT_DELIVERY_STATUS.SUPPRESSED
}

async function finalizeEvent(eventId: string): Promise<void> {
  const supabase = createAdminClient()
  const { data: deliveries } = await supabase.from('alert_deliveries').select('status').eq('event_id', eventId)
  const statuses = (deliveries ?? []).map((delivery) => delivery.status as StoredAlertDelivery['status'])
  if (statuses.length === 0) return
  const hasRetryable = statuses.some((status) => status === ALERT_DELIVERY_STATUS.PENDING || status === ALERT_DELIVERY_STATUS.RETRYABLE || status === ALERT_DELIVERY_STATUS.PROCESSING)
  if (hasRetryable) return
  const nextStatus = statuses.every((status) => status === ALERT_DELIVERY_STATUS.SUPPRESSED) ? ALERT_EVENT_STATUS.SUPPRESSED : ALERT_EVENT_STATUS.PROCESSED
  await supabase.from('alert_events').update({ status: nextStatus, processed_at: new Date().toISOString() }).eq('id', eventId)
}

function shouldSuppressBySettings(event: StoredAlertEvent, row: AlertProjectConfigRow | null): boolean {
  const config = normalizeProjectAlertConfig(row ?? {})
  if ((event.type === ALERT_EVENT_TYPE.COMPONENT_RECOVERED || event.type === ALERT_EVENT_TYPE.MONITOR_CHECK_RECOVERED) && !config.notify_recovery) return true
  if (event.type === ALERT_EVENT_TYPE.COMPONENT_STATUS_WORSENED || event.type === ALERT_EVENT_TYPE.COMPONENT_RECOVERED) return !config.alert_types.component_status
  if (event.type === ALERT_EVENT_TYPE.MONITOR_CHECK_FAILED || event.type === ALERT_EVENT_TYPE.MONITOR_CHECK_RECOVERED) return !config.alert_types.monitor_failure
  if (event.type === ALERT_EVENT_TYPE.INCIDENT_CREATED) return !config.alert_types.incident_created
  if (event.type === ALERT_EVENT_TYPE.INCIDENT_UPDATED) return !config.alert_types.incident_updated
  if (event.type === ALERT_EVENT_TYPE.INCIDENT_RESOLVED) return !config.alert_types.incident_resolved
  return false
}

function nextRetryDate(attempts: number): Date {
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]
  return new Date(Date.now() + minutes * 60_000)
}
