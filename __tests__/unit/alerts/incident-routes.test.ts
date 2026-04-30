import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const enqueueAlertEventMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/alerts/enqueue', () => ({
  ALERT_EVENT_TYPE: {
    INCIDENT_CREATED: 'incident_created',
    INCIDENT_UPDATED: 'incident_updated',
    INCIDENT_RESOLVED: 'incident_resolved',
  },
  ALERT_SOURCE_TYPE: { INCIDENT: 'incident' },
  createIncidentDedupeKey: (projectId: string, type: string, incidentId: string, status: string) => `${projectId}:${type}:incident:${incidentId}:${status}`,
  enqueueAlertEvent: enqueueAlertEventMock,
}))

interface MockQueryResult {
  data: unknown
  error: { message: string } | null
}

interface MockProject {
  id: string
  user_id: string
  name: string
  slug: string
  profiles?: { username?: string | null } | null
}

interface MockComponent {
  id: string
  project_id: string
  name: string
  status: string
}

interface MockIncident {
  id: string
  project_id: string
  title: string
  description: string | null
  status: string
  severity: string
  component_ids: string[]
  duration?: number
  created_at?: string
}

interface MockDataset {
  user: { id: string } | null
  project: MockProject | null
  components: MockComponent[]
  incidents: MockIncident[]
  incidentUpdates: unknown[]
  historyRows: unknown[]
}

class MockQuery implements PromiseLike<MockQueryResult> {
  private readonly filters = new Map<string, unknown>()
  private readonly inFilters = new Map<string, unknown[]>()
  private insertPayload: unknown = null
  private updatePayload: Record<string, unknown> | null = null

  constructor(private readonly table: string, private readonly dataset: MockDataset) {}

  select() { return this }
  eq(column: string, value: unknown) { this.filters.set(column, value); return this }
  in(column: string, values: unknown[]) { this.inFilters.set(column, values); return this }
  insert(payload: unknown) { this.insertPayload = payload; return this }
  update(payload: Record<string, unknown>) { this.updatePayload = payload; return this }

  async single(): Promise<MockQueryResult> { return this.resolveSingle() }

  then<TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolveMany().then(onfulfilled, onrejected)
  }

  private async resolveSingle(): Promise<MockQueryResult> {
    if (this.table === 'projects') return { data: this.matchProject(), error: null }
    if (this.table === 'incidents') return this.resolveIncidentSingle()
    if (this.table === 'incident_updates') return this.resolveIncidentUpdate()
    return this.resolveMany()
  }

  private async resolveMany(): Promise<MockQueryResult> {
    if (this.table === 'components') return this.resolveComponents()
    if (this.table === 'incidents') return { data: this.dataset.incidents.filter((incident) => this.matches(incident)), error: null }
    if (this.table === 'component_status_history') {
      this.dataset.historyRows.push(this.insertPayload)
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }

  private matchProject(): MockProject | null {
    const project = this.dataset.project
    if (!project) return null
    if (this.filters.get('id') !== project.id) return null
    if (this.filters.get('user_id') !== project.user_id) return null
    return project
  }

  private resolveIncidentSingle(): MockQueryResult {
    if (this.insertPayload) {
      const payload = this.insertPayload as Record<string, unknown>
      const incident: MockIncident = {
        id: 'incident-created',
        project_id: String(payload.project_id),
        title: String(payload.title),
        description: typeof payload.description === 'string' ? payload.description : null,
        status: String(payload.status),
        severity: String(payload.severity),
        component_ids: Array.isArray(payload.component_ids) ? payload.component_ids.filter((id): id is string => typeof id === 'string') : [],
        duration: 0,
        created_at: '2026-04-30T00:00:00.000Z',
      }
      this.dataset.incidents.push(incident)
      return { data: incident, error: null }
    }

    const incident = this.dataset.incidents.find((row) => this.matches(row)) ?? null
    if (incident && this.updatePayload) Object.assign(incident, this.updatePayload)
    return { data: incident, error: null }
  }

  private resolveIncidentUpdate(): MockQueryResult {
    const payload = this.insertPayload as Record<string, unknown>
    const update = {
      id: `update-${this.dataset.incidentUpdates.length + 1}`,
      incident_id: String(payload.incident_id),
      message: String(payload.message),
      status: String(payload.status),
      created_at: '2026-04-30T00:00:00.000Z',
    }
    this.dataset.incidentUpdates.push(update)
    return { data: update, error: null }
  }

  private resolveComponents(): MockQueryResult {
    const rows = this.dataset.components.filter((component) => this.matches(component))
    if (this.updatePayload) rows.forEach((component) => Object.assign(component, this.updatePayload))
    return { data: rows, error: null }
  }

  private matches(row: object): boolean {
    const record = row as Record<string, unknown>
    for (const [column, value] of this.filters) {
      if (record[column] !== value) return false
    }
    for (const [column, values] of this.inFilters) {
      if (!values.includes(record[column])) return false
    }
    return true
  }
}

function createSupabase(dataset: MockDataset) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: dataset.user } })) },
    from: (table: string) => new MockQuery(table, dataset),
  }
}

describe('incident routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    enqueueAlertEventMock.mockResolvedValue({ queued: true, error: null })
  })

  it('requires auth and ownership before creating an incident or enqueueing alerts', async () => {
    createClientMock.mockResolvedValue(createSupabase(createDataset({ user: null })))
    const { POST } = await import('@/app/api/incidents/route')

    const unauthenticated = await POST(createIncidentRequest())

    expect(unauthenticated.status).toBe(401)
    expect(enqueueAlertEventMock).not.toHaveBeenCalled()

    createClientMock.mockResolvedValue(createSupabase(createDataset({ user: { id: 'other-user' } })))
    const unauthorized = await POST(createIncidentRequest())

    expect(unauthorized.status).toBe(404)
    expect(enqueueAlertEventMock).not.toHaveBeenCalled()
  })

  it('creates an incident server-side, updates impacted components, and enqueues incident_created best-effort', async () => {
    const dataset = createDataset()
    createClientMock.mockResolvedValue(createSupabase(dataset))
    const { POST } = await import('@/app/api/incidents/route')

    const response = await POST(createIncidentRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.incident.id).toBe('incident-created')
    expect(body.component_updates).toEqual([{ id: 'component-1', status: 'major_outage' }])
    expect(dataset.components[0].status).toBe('major_outage')
    expect(dataset.historyRows).toEqual([{ component_id: 'component-1', status: 'major_outage', reason: 'incident', incident_id: 'incident-created' }])
    expect(enqueueAlertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      type: 'incident_created',
      sourceType: 'incident',
      sourceId: 'incident-created',
      dedupeKey: 'project-1:incident_created:incident:incident-created:investigating',
    }))
  })

  it('keeps incident creation successful when alert enqueue fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    enqueueAlertEventMock.mockResolvedValue({ queued: false, error: 'queue unavailable' })
    createClientMock.mockResolvedValue(createSupabase(createDataset()))
    const { POST } = await import('@/app/api/incidents/route')

    const response = await POST(createIncidentRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.alert.warning).toBe('queue unavailable')
    expect(warnSpy).toHaveBeenCalledWith('[alerts] incident alert enqueue failed after incident create', 'queue unavailable')
    warnSpy.mockRestore()
  })

  it('requires auth and ownership before updating an incident or enqueueing alerts', async () => {
    createClientMock.mockResolvedValue(createSupabase(createDataset({ user: null })))
    const { PATCH } = await import('@/app/api/incidents/[id]/route')

    const unauthenticated = await PATCH(updateIncidentRequest({ status: 'monitoring' }, 'Still investigating.'), { params: Promise.resolve({ id: 'incident-1' }) })

    expect(unauthenticated.status).toBe(401)
    expect(enqueueAlertEventMock).not.toHaveBeenCalled()

    createClientMock.mockResolvedValue(createSupabase(createDataset({ user: { id: 'other-user' } })))
    const unauthorized = await PATCH(updateIncidentRequest({ status: 'monitoring' }, 'Still investigating.'), { params: Promise.resolve({ id: 'incident-1' }) })

    expect(unauthorized.status).toBe(404)
    expect(enqueueAlertEventMock).not.toHaveBeenCalled()
  })

  it('updates an incident and enqueues incident_updated from authoritative server rows', async () => {
    const dataset = createDataset()
    createClientMock.mockResolvedValue(createSupabase(dataset))
    const { PATCH } = await import('@/app/api/incidents/[id]/route')

    const response = await PATCH(updateIncidentRequest({ status: 'monitoring' }, 'Mitigation underway.'), { params: Promise.resolve({ id: 'incident-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.incident.status).toBe('monitoring')
    expect(body.incident_update).toEqual(expect.objectContaining({ incident_id: 'incident-1', message: 'Mitigation underway.', status: 'monitoring' }))
    expect(enqueueAlertEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'incident_updated',
      sourceId: 'incident-1',
      dedupeKey: 'project-1:incident_updated:incident:incident-1:monitoring',
    }))
  })

  it('resolves an incident, restores components, and keeps mutation successful when alert enqueue fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    enqueueAlertEventMock.mockResolvedValue({ queued: false, error: 'queue unavailable' })
    const dataset = createDataset()
    createClientMock.mockResolvedValue(createSupabase(dataset))
    const { PATCH } = await import('@/app/api/incidents/[id]/route')

    const response = await PATCH(updateIncidentRequest({ status: 'resolved' }, 'Resolved.'), { params: Promise.resolve({ id: 'incident-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.component_updates).toEqual([{ id: 'component-1', status: 'operational' }])
    expect(body.alert.warning).toBe('queue unavailable')
    expect(dataset.components[0].status).toBe('operational')
    expect(dataset.historyRows).toEqual([{ component_id: 'component-1', status: 'operational', reason: 'incident_resolved', incident_id: 'incident-1' }])
    expect(enqueueAlertEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'incident_resolved' }))
    expect(warnSpy).toHaveBeenCalledWith('[alerts] incident alert enqueue failed after incident update', 'queue unavailable')
    warnSpy.mockRestore()
  })
})

function createDataset(overrides: Partial<Pick<MockDataset, 'user' | 'project'>> = {}): MockDataset {
  const user = Object.prototype.hasOwnProperty.call(overrides, 'user') ? overrides.user ?? null : { id: 'user-1' }
  const project = Object.prototype.hasOwnProperty.call(overrides, 'project')
    ? overrides.project ?? null
    : { id: 'project-1', user_id: 'user-1', name: 'Upvane Demo', slug: 'demo', profiles: { username: 'team' } }
  return {
    user,
    project,
    components: [{ id: 'component-1', project_id: 'project-1', name: 'API', status: 'degraded' }],
    incidents: [{ id: 'incident-1', project_id: 'project-1', title: 'Database outage', description: 'Primary database unavailable.', status: 'investigating', severity: 'critical', component_ids: ['component-1'], duration: 0, created_at: '2026-04-30T00:00:00.000Z' }],
    incidentUpdates: [],
    historyRows: [],
  }
}

function createIncidentRequest(): Request {
  return new Request('https://upvane.test/api/incidents', {
    method: 'POST',
    body: JSON.stringify({
      project_id: 'project-1',
      title: 'Database outage',
      description: 'Primary database unavailable.',
      status: 'investigating',
      severity: 'critical',
      component_ids: ['component-1'],
    }),
  })
}

function updateIncidentRequest(updates: Record<string, unknown>, message: string): Request {
  return new Request('https://upvane.test/api/incidents/incident-1', {
    method: 'PATCH',
    body: JSON.stringify({ updates, message }),
  })
}
