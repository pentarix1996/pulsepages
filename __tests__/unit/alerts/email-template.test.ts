import { describe, expect, it } from 'vitest'
import { renderAlertEmail } from '@/lib/alerts/templates/email'
import { ALERT_EVENT_STATUS, ALERT_EVENT_TYPE, ALERT_SOURCE_TYPE, type StoredAlertEvent } from '@/lib/alerts/types'

describe('alert email template', () => {
  it('renders Upvane branded html and text without optional monitor details', () => {
    const event: StoredAlertEvent = {
      id: 'event-1',
      project_id: 'project-1',
      type: ALERT_EVENT_TYPE.INCIDENT_CREATED,
      source_type: ALERT_SOURCE_TYPE.INCIDENT,
      source_id: 'incident-1',
      status: ALERT_EVENT_STATUS.PENDING,
      severity: 'high',
      dedupe_key: 'dedupe',
      created_at: '2026-04-30T12:00:00.000Z',
      processed_at: null,
      payload: {
        project_id: 'project-1',
        project_name: 'API',
        event_type: ALERT_EVENT_TYPE.INCIDENT_CREATED,
        status: 'investigating',
        severity: 'high',
        reason: 'Incident reported.',
        occurred_at: '2026-04-30T12:00:00.000Z',
        dashboard_url: 'https://app.upvane.com/project/project-1',
        status_page_url: 'https://upvane.com/status/acme/api',
        component: null,
        incident: { id: 'incident-1', title: 'API outage', status: 'investigating', severity: 'high', url: null },
        monitor: null,
      },
    }

    const email = renderAlertEmail(event, { recipients: ['ops@upvane.com'], template_variant: 'default' }, 'ops@upvane.com')
    expect(email.subject).toContain('[Upvane]')
    expect(email.html).toContain('Upvane Alert')
    expect(email.text).toContain('Incident: API outage')
    expect(email.text).not.toContain('Monitor:')
  })
})
