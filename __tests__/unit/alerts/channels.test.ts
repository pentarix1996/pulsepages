import { describe, expect, it } from 'vitest'
import { createAlertChannelRegistry, type AlertChannel } from '@/lib/alerts/channels'
import { ALERT_CHANNEL_TYPE, type AlertDeliveryResult } from '@/lib/alerts/types'

describe('alert channel registry', () => {
  it('registers fake future channels without processor branching', async () => {
    const fakeChannel: AlertChannel<unknown, string> = {
      type: ALERT_CHANNEL_TYPE.EMAIL,
      validate: (config) => config,
      getTargets: () => ['ops@upvane.com'],
      render: () => 'payload',
      deliver: async (): Promise<AlertDeliveryResult> => ({ status: 'sent', provider: 'fake', providerMessageId: '1', errorCode: null, errorMessage: null }),
    }

    const registry = createAlertChannelRegistry([fakeChannel as never])
    expect(registry.get(ALERT_CHANNEL_TYPE.EMAIL)).toBe(fakeChannel)
    expect(registry.list()).toHaveLength(1)
  })

  it('rejects duplicate channel adapters', () => {
    const channel: AlertChannel<unknown, unknown> = {
      type: ALERT_CHANNEL_TYPE.EMAIL,
      validate: (config) => config,
      getTargets: () => ['ops@upvane.com'],
      render: () => ({}),
      deliver: async () => ({ status: 'sent', provider: 'fake', providerMessageId: null, errorCode: null, errorMessage: null }),
    }
    expect(() => createAlertChannelRegistry([channel, channel])).toThrow(/Duplicate alert channel/)
  })
})
