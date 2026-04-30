import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const enqueueComponentTransitionAlertMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/alerts/enqueue', () => ({
  ALERT_SOURCE_TYPE: { MANUAL: 'manual' },
  enqueueComponentTransitionAlert: enqueueComponentTransitionAlertMock,
}))

interface MockQueryResult {
  data: unknown
  error: { message: string } | null
}

interface MockProject {
  id: string
  name: string
  slug: string
  user_id: string
  profiles?: { username?: string | null } | null
}

interface MockComponent {
  id: string
  project_id: string
  name: string
  status: string
}

interface MockDataset {
  user: { id: string } | null
  project: MockProject | null
  component: MockComponent | null
  historyRows: unknown[]
  updateError?: { message: string } | null
}

class MockQuery implements PromiseLike<MockQueryResult> {
  private readonly filters = new Map<string, unknown>()
  private updatePayload: Partial<MockComponent> | null = null
  private insertPayload: unknown = null

  constructor(private readonly table: string, private readonly dataset: MockDataset) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value)
    return this
  }

  update(payload: Partial<MockComponent>) {
    this.updatePayload = payload
    return this
  }

  insert(payload: unknown) {
    this.insertPayload = payload
    return this
  }

  async single(): Promise<MockQueryResult> {
    return this.resolve()
  }

  then<TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected)
  }

  private async resolve(): Promise<MockQueryResult> {
    if (this.table === 'projects') return { data: this.matchProject(), error: null }
    if (this.table === 'components') return this.resolveComponent()
    if (this.table === 'component_status_history') {
      this.dataset.historyRows.push(this.insertPayload)
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }

  private matchProject(): MockProject | null {
    if (!this.dataset.project) return null
    if (this.filters.get('id') !== this.dataset.project.id) return null
    if (this.filters.get('user_id') !== this.dataset.project.user_id) return null
    return this.dataset.project
  }

  private resolveComponent(): MockQueryResult {
    const component = this.dataset.component
    if (!component || this.filters.get('id') !== component.id || this.filters.get('project_id') !== component.project_id) {
      return { data: null, error: null }
    }
    if (this.updatePayload) {
      if (this.dataset.updateError) return { data: null, error: this.dataset.updateError }
      this.dataset.component = { ...component, ...this.updatePayload }
    }
    return { data: this.dataset.component, error: null }
  }
}

function createSupabase(dataset: MockDataset) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: dataset.user } })),
    },
    from: (table: string) => new MockQuery(table, dataset),
  }
}

describe('component status route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    enqueueComponentTransitionAlertMock.mockResolvedValue({ queued: true, skipped: false, error: null })
  })

  it('requires an authenticated user before mutating component status', async () => {
    createClientMock.mockResolvedValue(createSupabase({ user: null, project: null, component: null, historyRows: [] }))
    const { PATCH } = await import('@/app/api/components/[id]/status/route')

    const response = await PATCH(createRequest('major_outage'), { params: Promise.resolve({ id: 'component-1' }) })

    expect(response.status).toBe(401)
    expect(enqueueComponentTransitionAlertMock).not.toHaveBeenCalled()
  })

  it('requires project ownership before mutating or enqueueing alerts', async () => {
    const dataset: MockDataset = {
      user: { id: 'user-2' },
      project: { id: 'project-1', user_id: 'user-1', name: 'Upvane Demo', slug: 'demo', profiles: null },
      component: { id: 'component-1', project_id: 'project-1', name: 'API', status: 'degraded' },
      historyRows: [],
    }
    createClientMock.mockResolvedValue(createSupabase(dataset))
    const { PATCH } = await import('@/app/api/components/[id]/status/route')

    const response = await PATCH(createRequest('major_outage'), { params: Promise.resolve({ id: 'component-1' }) })

    expect(response.status).toBe(404)
    expect(dataset.component?.status).toBe('degraded')
    expect(dataset.historyRows).toHaveLength(0)
    expect(enqueueComponentTransitionAlertMock).not.toHaveBeenCalled()
  })

  it('updates component status and enqueues alert from server-loaded project/component rows', async () => {
    const dataset: MockDataset = {
      user: { id: 'user-1' },
      project: { id: 'project-1', user_id: 'user-1', name: 'Upvane Demo', slug: 'demo', profiles: { username: 'team' } },
      component: { id: 'component-1', project_id: 'project-1', name: 'API', status: 'degraded' },
      historyRows: [],
    }
    createClientMock.mockResolvedValue(createSupabase(dataset))
    const { PATCH } = await import('@/app/api/components/[id]/status/route')

    const response = await PATCH(createRequest('major_outage'), { params: Promise.resolve({ id: 'component-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.component.status).toBe('major_outage')
    expect(dataset.historyRows).toEqual([{ component_id: 'component-1', status: 'major_outage', reason: 'manual', incident_id: null }])
    expect(enqueueComponentTransitionAlertMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      projectName: 'Upvane Demo',
      componentId: 'component-1',
      componentName: 'API',
      previousStatus: 'degraded',
      currentStatus: 'major_outage',
      sourceType: 'manual',
      statusPageUrl: '/status/team/demo',
    }))
  })

  it('does not fail a successful component status mutation when alert enqueue fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    enqueueComponentTransitionAlertMock.mockResolvedValue({ queued: false, skipped: false, error: 'queue unavailable' })
    const dataset: MockDataset = {
      user: { id: 'user-1' },
      project: { id: 'project-1', user_id: 'user-1', name: 'Upvane Demo', slug: 'demo', profiles: null },
      component: { id: 'component-1', project_id: 'project-1', name: 'API', status: 'degraded' },
      historyRows: [],
    }
    createClientMock.mockResolvedValue(createSupabase(dataset))
    const { PATCH } = await import('@/app/api/components/[id]/status/route')

    const response = await PATCH(createRequest('major_outage'), { params: Promise.resolve({ id: 'component-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.component.status).toBe('major_outage')
    expect(body.alert.warning).toBe('queue unavailable')
    expect(warnSpy).toHaveBeenCalledWith('[alerts] component status alert enqueue failed after status update', 'queue unavailable')
    warnSpy.mockRestore()
  })
})

function createRequest(status: string): Request {
  return new Request('https://upvane.test/api/components/component-1/status', {
    method: 'PATCH',
    body: JSON.stringify({ project_id: 'project-1', status }),
  })
}
