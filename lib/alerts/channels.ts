import { ALERT_CHANNEL_TYPE, type AlertChannelConfigMetadata, type AlertChannelType, type AlertDeliveryInput, type AlertDeliveryResult, type StoredAlertEvent } from './types'

export const ALERT_CHANNEL_METADATA: AlertChannelConfigMetadata[] = [
  {
    type: ALERT_CHANNEL_TYPE.EMAIL,
    label: 'Email',
    description: 'Send operational alerts to one or more inboxes through Resend.',
    icon: 'mail',
    available: true,
  },
]

export interface AlertChannel<TConfig, TPayload> {
  type: AlertChannelType
  validate(config: unknown): TConfig
  getTargets(config: TConfig): string[]
  render(event: StoredAlertEvent, config: TConfig, target: string): TPayload
  deliver(input: AlertDeliveryInput<TPayload>): Promise<AlertDeliveryResult>
}

export interface AlertChannelRegistry {
  get(type: AlertChannelType): AlertChannel<unknown, unknown> | null
  list(): AlertChannel<unknown, unknown>[]
}

export function createAlertChannelRegistry(channels: AlertChannel<unknown, unknown>[]): AlertChannelRegistry {
  const adapters = new Map<AlertChannelType, AlertChannel<unknown, unknown>>()
  for (const channel of channels) {
    if (adapters.has(channel.type)) throw new Error(`Duplicate alert channel adapter: ${channel.type}`)
    adapters.set(channel.type, channel)
  }
  return {
    get(type) {
      return adapters.get(type) ?? null
    },
    list() {
      return [...adapters.values()]
    },
  }
}
