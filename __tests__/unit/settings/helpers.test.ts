// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ROUTABLE_EVENT_TYPES } from '@shared/domain.ts'
import { describeCooldown, describeEvents, describeRule, ruleSentenceText } from '@/components/panel/alerts/rule-sentence'
import type { PlanUsage } from '@/lib/domain/schemas/organizations'

vi.mock('@/lib/domain/access', () => ({ requireDashboardUser: vi.fn(), requireOrganization: vi.fn() }))
vi.mock('@/lib/domain/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/domain/cache', () => ({ invalidateStatusPage: vi.fn() }))

const { planChangeEffects } = await import('@/lib/domain/billing')
const { apiKeyStatus, generateApiKeySecret, scopesFor } = await import('@/lib/domain/api-keys')
const { apiReference, slugify, typeLabel } = await import('@/lib/api/reference')

function usage(overrides: Partial<PlanUsage> = {}): PlanUsage {
  return {
    status_pages: 1,
    monitors_total: 4,
    monitors_active: 4,
    monitors_paused_by_plan: 0,
    monitors_interval_below: { '60': 0, '180': 0 },
    monitors_regions_above: { '1': 0, '3': 0 },
    members: 2,
    pending_invitations: 0,
    largest_page: null,
    custom_domains: 0,
    private_pages: 0,
    paging_channels: 0,
    api_keys_active: 0,
    ...overrides,
  }
}

describe('planChangeEffects', () => {
  it('says nothing when the plan does not change', () => {
    expect(planChangeEffects(usage(), 'pro', 'pro')).toEqual([])
  })

  it('announces resumed monitors on upgrade', () => {
    expect(planChangeEffects(usage({ monitors_paused_by_plan: 1 }), 'free', 'pro')).toEqual(['1 monitor paused by the plan limit resume checking.', 'Limits rise to the Pro plan right away.'])
  })

  it('lists everything a downgrade to Free changes', () => {
    const effects = planChangeEffects(
      usage({
        status_pages: 3,
        monitors_active: 12,
        monitors_interval_below: { '60': 2, '180': 5 },
        monitors_regions_above: { '1': 4, '3': 1 },
        members: 6,
        custom_domains: 1,
        api_keys_active: 2,
        largest_page: { name: 'Quillbase', subscribers: 1500 } as PlanUsage['largest_page'],
      }),
      'pro',
      'free',
    )
    expect(effects).toEqual([
      '7 monitors of your 12 active ones will pause, newest first. They resume when you upgrade again.',
      '5 monitors will check every 180 seconds instead of more often.',
      '4 monitors will keep only 1 region.',
      '2 API keys stop working until you upgrade again.',
      'Custom domains are suspended and status pages show the Upvane badge again.',
      'You have 3 status pages and Free includes 1. They keep working, but you cannot add more.',
      'You have 6 members and Free includes 3. Nobody loses access, but you cannot invite more people.',
      'Quillbase has 1,500 subscribers; new sign-ups stop above 100.',
      'Status pages show the last 7 days of history.',
    ])
  })

  it('mentions paging and private pages when leaving Business', () => {
    const effects = planChangeEffects(usage({ paging_channels: 1, private_pages: 1 }), 'business', 'pro')
    expect(effects).toContain('PagerDuty and Opsgenie channels stop receiving alerts.')
    expect(effects).toContain('Private status pages stay private, but you cannot make other pages private.')
  })
})

describe('API keys', () => {
  const now = new Date('2026-10-09T12:00:00Z')

  it('derives status from revocation and expiry', () => {
    expect(apiKeyStatus({ revoked_at: null, expires_at: null }, now)).toBe('active')
    expect(apiKeyStatus({ revoked_at: null, expires_at: '2026-10-10T00:00:00Z' }, now)).toBe('active')
    expect(apiKeyStatus({ revoked_at: null, expires_at: '2026-10-09T12:00:00Z' }, now)).toBe('expired')
    expect(apiKeyStatus({ revoked_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-09T00:00:00Z' }, now)).toBe('revoked')
  })

  it('maps access to scopes', () => {
    expect(scopesFor('read')).toEqual(['read'])
    expect(scopesFor('write')).toEqual(['read', 'write'])
  })

  it('keeps only a hash and a short prefix of new secrets', async () => {
    const secret = await generateApiKeySecret()
    expect(secret.token).toMatch(/^upv_live_[A-Za-z0-9]{20,}$/)
    expect(secret.prefix).toBe(secret.token.slice(0, 13))
    expect(secret.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(secret.tokenHash).not.toContain(secret.token.slice(9))
  })
})

describe('rule sentences', () => {
  const lookups = {
    channels: new Map([
      ['c1', { name: 'Team email', enabled: true }],
      ['c2', { name: '#ops', enabled: false }],
    ]),
    components: new Map([
      ['api', 'API'],
      ['web', 'Website'],
      ['db', 'Database'],
    ]),
    monitors: new Map([['m1', 'Checkout']]),
  }

  it('summarises event selections by group', () => {
    expect(describeEvents([...ROUTABLE_EVENT_TYPES])).toBe('Every event')
    expect(describeEvents([])).toBe('No events')
    expect(describeEvents(['component_status_worsened', 'component_recovered', 'monitor_down'])).toBe('Component changes and monitors (down)')
  })

  it('formats cooldowns', () => {
    expect(describeCooldown(0)).toBe('no cooldown')
    expect(describeCooldown(15)).toBe('cooldown 15 min')
    expect(describeCooldown(90)).toBe('cooldown 1 h 30 min')
    expect(describeCooldown(120)).toBe('cooldown 2 h')
  })

  it('reads as one line and flags rules that cannot deliver', () => {
    const sentence = describeRule(
      { event_types: ['incident_created'], channel_ids: ['c1', 'c2', 'gone'], component_ids: ['api', 'web', 'db'], monitor_ids: ['m1'], min_status: 'partial_outage', cooldown_minutes: 15 },
      lookups,
    )
    expect(ruleSentenceText(sentence)).toBe('Incidents (new) → Team email, #ops (off), deleted channel · API, Website +1 · monitors: Checkout · partial outage or worse · cooldown 15 min')
    expect(sentence.warnings).toEqual([])
    expect(describeRule({ event_types: [], channel_ids: [], component_ids: [], monitor_ids: [], min_status: null, cooldown_minutes: 0 }, lookups).warnings).toEqual(['No channel: matching events are not sent anywhere.'])
    expect(describeRule({ event_types: [], channel_ids: ['c2'], component_ids: [], monitor_ids: [], min_status: null, cooldown_minutes: 0 }, lookups).warnings).toEqual(['Every channel of this rule is off.'])
  })
})

describe('API reference', () => {
  it('labels schema types', () => {
    expect(typeLabel({ $ref: '#/components/schemas/Component' })).toBe('Component')
    expect(typeLabel({ type: 'string', enum: ['up', 'down'] })).toBe('one of up, down')
    expect(typeLabel({ type: 'array', items: { type: 'string', enum: ['read', 'write'] } })).toBe('list of read, write')
    expect(typeLabel({ type: 'array', items: { type: 'string', format: 'uuid' } })).toBe('uuid[]')
    expect(typeLabel({ anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] })).toBe('timestamp | null')
    expect(typeLabel({ type: 'object', additionalProperties: { type: 'integer' } })).toBe('map of integer')
    expect(typeLabel(undefined)).toBe('any')
  })

  it('slugifies tag names', () => {
    expect(slugify('Status pages & Subscribers')).toBe('status-pages-subscribers')
  })

  it('documents every operation with a scope and marks paginated lists', () => {
    const reference = apiReference('https://api.upvane.com/v1')
    const operations = reference.tags.flatMap((tag) => tag.operations)
    expect(operations.length).toBeGreaterThan(40)
    expect(new Set(operations.map((operation) => operation.id)).size).toBe(operations.length)
    for (const operation of operations) expect(['read', 'write', 'none']).toContain(operation.scope)
    const list = operations.find((operation) => operation.method === 'GET' && operation.path.endsWith('/incidents'))
    expect(list?.response.type).toMatch(/\[\] \(paginated\)$/)
    const create = operations.find((operation) => operation.method === 'POST' && /\/monitors$/.test(operation.path))
    expect(create?.body.find((field) => field.name === 'type')?.type).toMatch(/^one of .*http.*tcp/)
  })
})
