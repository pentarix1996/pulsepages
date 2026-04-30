import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const enqueueAlertEventMock = vi.fn()
const enqueueComponentTransitionAlertMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/alerts/enqueue', () => ({
  ALERT_EVENT_TYPE: {
    COMPONENT_STATUS_WORSENED: 'component_status_worsened',
    COMPONENT_RECOVERED: 'component_recovered',
    INCIDENT_CREATED: 'incident_created',
    INCIDENT_UPDATED: 'incident_updated',
    INCIDENT_RESOLVED: 'incident_resolved',
    TEST: 'test',
  },
  ALERT_SOURCE_TYPE: {
    MANUAL: 'manual',
    INCIDENT: 'incident',
  },
  createIncidentDedupeKey: (projectId: string, type: string, incidentId: string, status: string) => `${projectId}:${type}:incident:${incidentId}:${status}`,
  enqueueAlertEvent: enqueueAlertEventMock,
  enqueueComponentTransitionAlert: enqueueComponentTransitionAlertMock,
}))

interface MockQueryResult {
  data: unknown
  error: { message: string } | null
}

interface MockDataset {
  user: { id: string } | null
  project: unknown
  component: unknown
  incident: unknown
}

class MockQuery implements PromiseLike<MockQueryResult> {
  private columns = ''
  private readonly filters = new Map<string, unknown>()

  constructor(private readonly table: string, private readonly dataset: MockDataset) {}

  select(columns?: string) {
    this.columns = columns ?? ''
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value)
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
    if (this.table === 'projects') {
      if (this.columns === 'id') return { data: this.dataset.project ? { id: this.filters.get('id') } : null, error: null }
      return { data: this.dataset.project, error: null }
    }
    if (this.table === 'components') return { data: this.dataset.component, error: null }
    if (this.table === 'incidents') return { data: this.dataset.incident, error: null }
    return { data: null, error: null }
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

describe('alerts events route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enqueueAlertEventMock.mockResolvedValue({ queued: true, error: null })
    enqueueComponentTransitionAlertMock.mockResolvedValue({ queued: true, skipped: false, error: null })
  })

  it('requires an authenticated user before accepting alert intents', async () => {
    createClientMock.mockResolvedValue(createSupabase({ user: null, project: null, component: null, incident: null }))
    const { POST } = await import('@/app/api/alerts/events/route')

    const response = await POST(new Request('https://upvane.test/api/alerts/events', {
      method: 'POST',
      body: JSON.stringify({ intent: 'component_transition', project_id: 'project-1', component_id: 'component-1', previous_status: 'degraded' }),
    }))

    expect(response.status).toBe(401)
    expect(enqueueComponentTransitionAlertMock).not.toHaveBeenCalled()
  })

  it('accepts manual component transition intents and builds alerts from server-loaded rows', async () => {
    createClientMock.mockResolvedValue(createSupabase({
      user: { id: 'user-1' },
      project: { id: 'project-1', name: 'Upvane Demo', slug: 'demo', profiles: { username: 'team' } },
      component: { id: 'component-1', name: 'API', status: 'major_outage' },
      incident: null,
    }))
    const { POST } = await import('@/app/api/alerts/events/route')

    const response = await POST(new Request('https://upvane.test/api/alerts/events', {
      method: 'POST',
      body: JSON.stringify({ intent: 'component_transition', project_id: 'project-1', component_id: 'component-1', previous_status: 'degraded', reason: 'Manual status change.' }),
    }))

    expect(response.status).toBe(200)
    expect(enqueueComponentTransitionAlertMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      projectName: 'Upvane Demo',
      componentId: 'component-1',
      componentName: 'API',
      previousStatus: 'degraded',
      currentStatus: 'major_outage',
      reason: 'Manual status change.',
      statusPageUrl: '/status/team/demo',
    }))
  })

  it('rejects client-constructed legacy alert payloads', async () => {
    createClientMock.mockResolvedValue(createSupabase({ user: { id: 'user-1' }, project: { id: 'project-1' }, component: null, incident: null }))
    const { POST } = await import('@/app/api/alerts/events/route')

    const response = await POST(new Request('https://upvane.test/api/alerts/events', {
      method: 'POST',
      body: JSON.stringify({ project_id: 'project-1', type: 'component_status_worsened', source_id: 'component-1', dedupe_key: 'client-key', payload: { severity: 'major_outage' } }),
    }))

    expect(response.status).toBe(400)
    expect(enqueueComponentTransitionAlertMock).not.toHaveBeenCalled()
  })

  it('accepts incident intents and enqueues payloads with server-loaded incident data', async () => {
    createClientMock.mockResolvedValue(createSupabase({
      user: { id: 'user-1' },
      project: { id: 'project-1', name: 'Upvane Demo', slug: 'demo', profiles: null },
      component: null,
      incident: { id: 'incident-1', title: 'Database outage', status: 'resolved', severity: 'critical' },
    }))
    const { POST } = await import('@/app/api/alerts/events/route')

    const response = await POST(new Request('https://upvane.test/api/alerts/events', {
      method: 'POST',
      body: JSON.stringify({ intent: 'incident_event', project_id: 'project-1', incident_id: 'incident-1', type: 'incident_resolved', reason: 'Resolved.' }),
    }))

    expect(response.status).toBe(200)
    expect(enqueueAlertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      type: 'incident_resolved',
      sourceId: 'incident-1',
      severity: 'critical',
      dedupeKey: 'project-1:incident_resolved:incident:incident-1:resolved',
      payload: expect.objectContaining({ project_name: 'Upvane Demo', status: 'resolved', severity: 'critical' }),
    }))
  })
})
