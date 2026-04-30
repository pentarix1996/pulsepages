import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

interface MockQueryResult {
  data: unknown
  error: { message: string } | null
}

interface MockDataset {
  user: { id: string } | null
  project: { id: string; user_id: string; plan?: string } | null
  projectConfig: unknown
  channelConfig: unknown
  deliveries: unknown[]
  upserts: unknown[]
}

class MockQuery implements PromiseLike<MockQueryResult> {
  private readonly filters = new Map<string, unknown>()
  private upsertPayload: unknown = null

  constructor(private readonly table: string, private readonly dataset: MockDataset) {}

  select() { return this }
  order() { return this }
  limit() { return this }
  eq(column: string, value: unknown) { this.filters.set(column, value); return this }
  upsert(payload: unknown) { this.upsertPayload = payload; return this }

  async single(): Promise<MockQueryResult> { return this.resolve() }
  async maybeSingle(): Promise<MockQueryResult> { return this.resolve() }

  then<TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected)
  }

  private async resolve(): Promise<MockQueryResult> {
    if (this.upsertPayload) {
      this.dataset.upserts.push(this.upsertPayload)
      return { data: this.upsertPayload, error: null }
    }
    if (this.table === 'projects') return { data: this.matchProject(), error: null }
    if (this.table === 'project_alert_configs') return { data: this.dataset.projectConfig, error: null }
    if (this.table === 'alert_channel_configs') return { data: this.dataset.channelConfig, error: null }
    if (this.table === 'alert_deliveries') return { data: this.dataset.deliveries, error: null }
    return { data: null, error: null }
  }

  private matchProject(): MockDataset['project'] {
    const project = this.dataset.project
    if (!project) return null
    if (this.filters.get('id') !== project.id) return null
    if (this.filters.get('user_id') !== project.user_id) return null
    return project
  }
}

function createSupabase(dataset: MockDataset) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: dataset.user } })) },
    from: (table: string) => new MockQuery(table, dataset),
  }
}

describe('alerts config route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('allows a Free plan project to save email alerts configuration', async () => {
    const dataset: MockDataset = {
      user: { id: 'user-1' },
      project: { id: 'project-1', user_id: 'user-1', plan: 'free' },
      projectConfig: null,
      channelConfig: null,
      deliveries: [],
      upserts: [],
    }
    createClientMock.mockResolvedValue(createSupabase(dataset))
    const { PATCH } = await import('@/app/api/alerts/config/route')

    const response = await PATCH(new Request('https://upvane.test/api/alerts/config', {
      method: 'PATCH',
      body: JSON.stringify({
        project_id: 'project-1',
        projectConfig: { enabled: true, cooldown_minutes: 30, notify_recovery: true, alert_types: { component_status: true } },
        emailChannel: { enabled: true, config: { recipients: ['Founder@Upvane.com'] } },
      }),
    }))

    expect(response.status).toBe(200)
    expect(dataset.upserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ project_id: 'project-1', enabled: true, cooldown_minutes: 30 }),
      expect.objectContaining({ project_id: 'project-1', type: 'email', enabled: true, config: { recipients: ['founder@upvane.com'], template_variant: 'default' } }),
    ]))
  })

  it('denies alerts config changes for projects outside the authenticated owner', async () => {
    const dataset: MockDataset = {
      user: { id: 'user-2' },
      project: { id: 'project-1', user_id: 'user-1', plan: 'free' },
      projectConfig: null,
      channelConfig: null,
      deliveries: [],
      upserts: [],
    }
    createClientMock.mockResolvedValue(createSupabase(dataset))
    const { PATCH } = await import('@/app/api/alerts/config/route')

    const response = await PATCH(new Request('https://upvane.test/api/alerts/config', {
      method: 'PATCH',
      body: JSON.stringify({
        project_id: 'project-1',
        projectConfig: { enabled: true, cooldown_minutes: 30, notify_recovery: true, alert_types: { component_status: true } },
        emailChannel: { enabled: true, config: { recipients: ['Founder@Upvane.com'] } },
      }),
    }))

    expect(response.status).toBe(404)
    expect(dataset.upserts).toEqual([])
  })
})
