import { describe, expect, it } from 'vitest'
import { buildMonitorTransitionAlertEvent } from '../../../supabase/functions/monitor-runner/alert-payload'

describe('monitor runner alert payload helper', () => {
  it('snapshots monitor result details and links for worsening monitor transitions', () => {
    const row = buildMonitorTransitionAlertEvent({
      config: { id: 'monitor-1', project_id: 'project-1', component_id: 'component-1' },
      component: {
        id: 'component-1',
        name: 'API',
        projects: { name: 'Upvane Demo', slug: 'demo', profiles: { username: 'team' } },
      },
      previousStatus: 'operational',
      result: {
        checkStatus: 'failure',
        resultingStatus: 'major_outage',
        httpStatus: 503,
        responseTimeMs: 1240,
        errorMessage: 'Unexpected HTTP status 503.',
      },
      checkedAt: '2026-04-30T12:00:00.000Z',
    })

    expect(row).toEqual(expect.objectContaining({
      project_id: 'project-1',
      type: 'component_status_worsened',
      source_type: 'monitor_edge_runner',
      source_id: 'monitor-1',
      severity: 'major_outage',
      dedupe_key: 'project-1:component_status_worsened:component:component-1:major_outage',
    }))
    expect(row?.payload).toEqual(expect.objectContaining({
      project_id: 'project-1',
      project_name: 'Upvane Demo',
      event_type: 'component_status_worsened',
      status: 'major_outage',
      severity: 'major_outage',
      reason: 'Unexpected HTTP status 503.',
      occurred_at: '2026-04-30T12:00:00.000Z',
      dashboard_url: null,
      status_page_url: '/status/team/demo',
      component: {
        id: 'component-1',
        name: 'API',
        previous_status: 'operational',
        current_status: 'major_outage',
      },
      incident: null,
      monitor: {
        status: 'failure',
        http_status: 503,
        response_time_ms: 1240,
        error_message: 'Unexpected HTTP status 503.',
        checked_at: '2026-04-30T12:00:00.000Z',
      },
    }))
  })

  it('returns null when the monitor transition is not alertable', () => {
    const row = buildMonitorTransitionAlertEvent({
      config: { id: 'monitor-1', project_id: 'project-1', component_id: 'component-1' },
      component: { name: 'API' },
      previousStatus: 'major_outage',
      result: { checkStatus: 'failure', resultingStatus: 'degraded', httpStatus: 500, responseTimeMs: 20, errorMessage: 'Still failing.' },
      checkedAt: '2026-04-30T12:00:00.000Z',
    })

    expect(row).toBeNull()
  })
})
