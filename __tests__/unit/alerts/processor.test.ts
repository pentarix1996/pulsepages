import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAlertChannelRegistry, type AlertChannel } from '@/lib/alerts/channels'
import {
  ALERT_CHANNEL_TYPE,
  ALERT_DELIVERY_STATUS,
  ALERT_EVENT_STATUS,
  ALERT_EVENT_TYPE,
  ALERT_SOURCE_TYPE,
  type AlertDeliveryResult,
  type StoredAlertDelivery,
  type StoredAlertEvent,
} from '@/lib/alerts/types'

const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

interface MockChannelConfigRow {
  id: string
  project_id: string
  type: typeof ALERT_CHANNEL_TYPE.EMAIL
  enabled: boolean
  config: unknown
}

interface MockProjectConfigRow {
  project_id: string
  enabled: boolean
  cooldown_minutes: number
  notify_recovery: boolean
  alert_types: Record<string, boolean>
}

interface MockCooldownRow {
  project_id: string
  channel_type: typeof ALERT_CHANNEL_TYPE.EMAIL
  dedupe_key: string
  last_sent_at: string
  last_event_id: string
}

interface MockDataset {
  events: StoredAlertEvent[]
  projectConfigs: MockProjectConfigRow[]
  channelConfigs: MockChannelConfigRow[]
  deliveries: StoredAlertDelivery[]
  cooldowns: MockCooldownRow[]
  claimConflicts?: string[]
}

interface MockQueryResult {
  data: unknown
  error: { message: string } | null
  count?: number | null
}

class MockQuery implements PromiseLike<MockQueryResult> {
  private readonly eqFilters = new Map<string, unknown>()
  private readonly inFilters = new Map<string, unknown[]>()
  private countMode = false
  private headMode = false
  private updatePayload: Record<string, unknown> | null = null
  private insertPayload: Record<string, unknown>[] | null = null
  private upsertPayload: MockCooldownRow | null = null
  private updatedRows: unknown[] | null = null

  constructor(private readonly table: string, private readonly dataset: MockDataset) {}

  select(_columns?: string, options?: { count?: 'exact'; head?: boolean }) {
    this.countMode = options?.count === 'exact'
    this.headMode = options?.head === true
    return this
  }

  eq(column: string, value: unknown) {
    this.eqFilters.set(column, value)
    return this
  }

  in(column: string, value: unknown[]) {
    this.inFilters.set(column, value)
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  or() {
    return this
  }

  maybeSingle() {
    return this.resolveSingle()
  }

  insert(rows: Record<string, unknown>[]) {
    this.insertPayload = rows
    return this.resolve()
  }

  update(payload: Record<string, unknown>) {
    this.updatePayload = payload
    return this
  }

  upsert(row: MockCooldownRow) {
    this.upsertPayload = row
    return this.resolve()
  }

  then<TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected)
  }

  private async resolveSingle(): Promise<MockQueryResult> {
    if (this.updatePayload) this.applyUpdate()
    const rows = this.rows()
    return { data: rows[0] ?? null, error: null }
  }

  private async resolve(): Promise<MockQueryResult> {
    if (this.insertPayload) this.applyInsert()
    if (this.updatePayload) this.applyUpdate()
    if (this.upsertPayload) this.applyUpsert()

    const rows = this.rows()
    if (this.countMode && this.headMode) return { data: null, error: null, count: rows.length }
    if (this.updatedRows) return { data: this.updatedRows, error: null }
    return { data: rows, error: null }
  }

  private rows(): unknown[] {
    const source = this.sourceRows()
    return source.filter((row) => this.matches(row))
  }

  private sourceRows(): unknown[] {
    if (this.table === 'alert_events') return this.dataset.events
    if (this.table === 'project_alert_configs') return this.dataset.projectConfigs
    if (this.table === 'alert_channel_configs') return this.dataset.channelConfigs
    if (this.table === 'alert_deliveries') return this.dataset.deliveries
    if (this.table === 'alert_cooldowns') return this.dataset.cooldowns
    return []
  }

  private matches(row: unknown): boolean {
    if (!isRecord(row)) return false
    for (const [column, value] of this.eqFilters) {
      if (row[column] !== value) return false
    }
    for (const [column, values] of this.inFilters) {
      if (!values.includes(row[column])) return false
    }
    return true
  }

  private applyInsert(): void {
    if (this.table !== 'alert_deliveries' || !this.insertPayload) return
    for (const row of this.insertPayload) {
      this.dataset.deliveries.push({
        id: `delivery-${this.dataset.deliveries.length + 1}`,
        event_id: String(row.event_id),
        channel_config_id: String(row.channel_config_id),
        target: String(row.target),
        status: ALERT_DELIVERY_STATUS.PENDING,
        attempts: 0,
        next_retry_at: null,
        provider: null,
        provider_message_id: null,
        idempotency_key: String(row.idempotency_key),
        error_code: null,
        error_message: null,
        sent_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  private applyUpdate(): void {
    if (!this.updatePayload) return
    if (this.applyClaimConflict()) return
    const rows = this.rows()
    for (const row of rows) {
      if (isRecord(row)) Object.assign(row, this.updatePayload)
    }
    this.updatedRows = rows
  }

  private applyClaimConflict(): boolean {
    if (this.table !== 'alert_deliveries') return false
    if (this.updatePayload?.status !== ALERT_DELIVERY_STATUS.PROCESSING) return false
    const id = this.eqFilters.get('id')
    if (typeof id !== 'string' || !this.dataset.claimConflicts?.includes(id)) return false
    this.updatedRows = []
    return true
  }

  private applyUpsert(): void {
    if (this.table !== 'alert_cooldowns' || !this.upsertPayload) return
    const index = this.dataset.cooldowns.findIndex((cooldown) => cooldown.project_id === this.upsertPayload?.project_id
      && cooldown.channel_type === this.upsertPayload?.channel_type
      && cooldown.dedupe_key === this.upsertPayload?.dedupe_key)
    if (index >= 0) this.dataset.cooldowns[index] = this.upsertPayload
    else this.dataset.cooldowns.push(this.upsertPayload)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function createSupabase(dataset: MockDataset) {
  return {
    from: (table: string) => new MockQuery(table, dataset),
  }
}

function createEvent(id: string): StoredAlertEvent {
  return {
    id,
    project_id: 'project-1',
    type: ALERT_EVENT_TYPE.COMPONENT_STATUS_WORSENED,
    source_type: ALERT_SOURCE_TYPE.MANUAL,
    source_id: 'component-1',
    status: ALERT_EVENT_STATUS.PENDING,
    severity: 'major_outage',
    dedupe_key: 'project-1:component_status_worsened:component:component-1:major_outage',
    payload: {
      project_id: 'project-1',
      project_name: 'Upvane Demo',
      event_type: ALERT_EVENT_TYPE.COMPONENT_STATUS_WORSENED,
      status: 'major_outage',
      severity: 'major_outage',
      reason: 'Component status changed.',
      occurred_at: new Date().toISOString(),
      dashboard_url: null,
      status_page_url: null,
      component: { id: 'component-1', name: 'API', previous_status: 'degraded', current_status: 'major_outage' },
      incident: null,
      monitor: null,
    },
    created_at: new Date().toISOString(),
    processed_at: null,
  }
}

function createDataset(event: StoredAlertEvent): MockDataset {
  return {
    events: [event],
    projectConfigs: [{
      project_id: 'project-1',
      enabled: true,
      cooldown_minutes: 30,
      notify_recovery: true,
      alert_types: {
        component_status: true,
        monitor_failure: true,
        incident_created: true,
        incident_updated: true,
        incident_resolved: true,
      },
    }],
    channelConfigs: [{ id: 'channel-1', project_id: 'project-1', type: ALERT_CHANNEL_TYPE.EMAIL, enabled: true, config: { recipients: ['a@upvane.com', 'b@upvane.com'] } }],
    deliveries: [],
    cooldowns: [],
  }
}

describe('alerts processor cooldown behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('processes all recipients for one accepted event before cooldown suppresses anything', async () => {
    const event = createEvent('event-1')
    const dataset = createDataset(event)
    const deliver = vi.fn(async (): Promise<AlertDeliveryResult> => ({ status: 'sent', provider: 'fake', providerMessageId: 'message-1', errorCode: null, errorMessage: null }))
    createAdminClientMock.mockReturnValue(createSupabase(dataset))

    const { processPendingAlerts } = await import('@/lib/alerts/processor')
    const registry = createAlertChannelRegistry([createFakeChannel(deliver) as never])
    const result = await processPendingAlerts(registry)

    expect(result.sent).toBe(2)
    expect(result.suppressed).toBe(0)
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(dataset.deliveries).toHaveLength(2)
    expect(dataset.deliveries.map((delivery) => delivery.status)).toEqual([ALERT_DELIVERY_STATUS.SENT, ALERT_DELIVERY_STATUS.SENT])
    expect(dataset.cooldowns).toHaveLength(1)
    expect(dataset.cooldowns[0]?.last_event_id).toBe('event-1')
  })

  it('suppresses a later duplicate event within the cooldown window', async () => {
    const event = createEvent('event-2')
    const dataset = createDataset(event)
    dataset.cooldowns.push({
      project_id: 'project-1',
      channel_type: ALERT_CHANNEL_TYPE.EMAIL,
      dedupe_key: event.dedupe_key,
      last_sent_at: new Date().toISOString(),
      last_event_id: 'event-1',
    })
    const deliver = vi.fn(async (): Promise<AlertDeliveryResult> => ({ status: 'sent', provider: 'fake', providerMessageId: 'message-1', errorCode: null, errorMessage: null }))
    createAdminClientMock.mockReturnValue(createSupabase(dataset))

    const { processPendingAlerts } = await import('@/lib/alerts/processor')
    const registry = createAlertChannelRegistry([createFakeChannel(deliver) as never])
    const result = await processPendingAlerts(registry)

    expect(result.sent).toBe(0)
    expect(result.suppressed).toBe(2)
    expect(deliver).not.toHaveBeenCalled()
    expect(dataset.deliveries).toHaveLength(2)
    expect(dataset.deliveries.map((delivery) => delivery.status)).toEqual([ALERT_DELIVERY_STATUS.SUPPRESSED, ALERT_DELIVERY_STATUS.SUPPRESSED])
    expect(dataset.events[0]?.status).toBe(ALERT_EVENT_STATUS.SUPPRESSED)
  })

  it('suppresses recovery events when recovery notifications are disabled', async () => {
    const event = createEvent('event-recovery')
    event.type = ALERT_EVENT_TYPE.COMPONENT_RECOVERED
    event.severity = 'operational'
    event.dedupe_key = 'project-1:component_recovered:component:component-1:recovered'
    event.payload = {
      ...event.payload,
      event_type: ALERT_EVENT_TYPE.COMPONENT_RECOVERED,
      status: 'operational',
      severity: 'operational',
      component: { id: 'component-1', name: 'API', previous_status: 'major_outage', current_status: 'operational' },
    }
    const dataset = createDataset(event)
    dataset.projectConfigs[0]!.notify_recovery = false
    const deliver = vi.fn(async (): Promise<AlertDeliveryResult> => ({ status: 'sent', provider: 'fake', providerMessageId: 'message-1', errorCode: null, errorMessage: null }))
    createAdminClientMock.mockReturnValue(createSupabase(dataset))

    const { processPendingAlerts } = await import('@/lib/alerts/processor')
    const registry = createAlertChannelRegistry([createFakeChannel(deliver) as never])
    const result = await processPendingAlerts(registry)

    expect(result.suppressed).toBe(1)
    expect(deliver).not.toHaveBeenCalled()
    expect(dataset.deliveries).toHaveLength(0)
    expect(dataset.events[0]?.status).toBe(ALERT_EVENT_STATUS.SUPPRESSED)
  })

  it('does not duplicate already sent deliveries when retrying an event', async () => {
    const event = createEvent('event-retry')
    const dataset = createDataset(event)
    dataset.deliveries.push(createDelivery('delivery-sent', event.id, 'a@upvane.com', ALERT_DELIVERY_STATUS.SENT))
    dataset.deliveries.push(createDelivery('delivery-retry', event.id, 'b@upvane.com', ALERT_DELIVERY_STATUS.RETRYABLE))
    const deliver = vi.fn(async (): Promise<AlertDeliveryResult> => ({ status: 'sent', provider: 'fake', providerMessageId: 'message-1', errorCode: null, errorMessage: null }))
    createAdminClientMock.mockReturnValue(createSupabase(dataset))

    const { processPendingAlerts } = await import('@/lib/alerts/processor')
    const registry = createAlertChannelRegistry([createFakeChannel(deliver) as never])
    const result = await processPendingAlerts(registry)

    expect(result.sent).toBe(1)
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ payload: 'payload:b@upvane.com' }))
    expect(dataset.deliveries.find((delivery) => delivery.id === 'delivery-sent')?.provider_message_id).toBeNull()
    expect(dataset.deliveries.find((delivery) => delivery.id === 'delivery-retry')?.status).toBe(ALERT_DELIVERY_STATUS.SENT)
  })

  it('skips delivery when the processing row claim is lost', async () => {
    const event = createEvent('event-claim')
    const dataset = createDataset(event)
    dataset.deliveries.push(createDelivery('delivery-raced', event.id, 'a@upvane.com', ALERT_DELIVERY_STATUS.RETRYABLE))
    dataset.claimConflicts = ['delivery-raced']
    const deliver = vi.fn(async (): Promise<AlertDeliveryResult> => ({ status: 'sent', provider: 'fake', providerMessageId: 'message-1', errorCode: null, errorMessage: null }))
    createAdminClientMock.mockReturnValue(createSupabase(dataset))

    const { processPendingAlerts } = await import('@/lib/alerts/processor')
    const registry = createAlertChannelRegistry([createFakeChannel(deliver) as never])
    const result = await processPendingAlerts(registry)

    expect(result.sent).toBe(0)
    expect(deliver).not.toHaveBeenCalled()
    expect(dataset.deliveries[0]?.status).toBe(ALERT_DELIVERY_STATUS.RETRYABLE)
  })
})

function createDelivery(id: string, eventId: string, target: string, status: StoredAlertDelivery['status']): StoredAlertDelivery {
  return {
    id,
    event_id: eventId,
    channel_config_id: 'channel-1',
    target,
    status,
    attempts: status === ALERT_DELIVERY_STATUS.RETRYABLE ? 1 : 0,
    next_retry_at: null,
    provider: null,
    provider_message_id: null,
    idempotency_key: `${eventId}:channel-1:${target}`,
    error_code: null,
    error_message: null,
    sent_at: status === ALERT_DELIVERY_STATUS.SENT ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function createFakeChannel(deliver: (input: unknown) => Promise<AlertDeliveryResult>): AlertChannel<unknown, string> {
  return {
    type: ALERT_CHANNEL_TYPE.EMAIL,
    validate: (config) => config,
    getTargets: () => ['a@upvane.com', 'b@upvane.com'],
    render: (_event, _config, target) => `payload:${target}`,
    deliver,
  }
}
