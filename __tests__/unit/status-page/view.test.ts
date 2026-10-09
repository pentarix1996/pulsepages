// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildAtom, buildRss, feedEntries, feedUpdated, xmlEscape, type FeedDocument } from '@/lib/status-page/feeds'
import type { PageLocation } from '@/lib/status-page/links'
import { buildStatusJson, buildSummaryJson } from '@/lib/status-page/summary'
import type { StatusComponent, StatusIncident, StatusMaintenance, StatusPageData } from '@/lib/status-page/types'
import { componentSections, durationBetween, joinNames, overallSummary, pageTitle, pastDays, updateComponentChanges, updateTone, windowUptime } from '@/lib/status-page/view'

const LOCATION: PageLocation = { organizationSlug: 'quillbase', projectSlug: 'status', customDomain: null, onCustomDomain: false }
const APP = 'https://app.upvane.com'

function component(id: string, name: string, overrides: Partial<StatusComponent> = {}): StatusComponent {
  return { id, name, slug: name.toLowerCase(), description: null, status: 'operational', group_id: null, position: 0, uptime: 100, days: [], ...overrides }
}

function incident(overrides: Partial<StatusIncident> = {}): StatusIncident {
  return {
    id: 'inc-1',
    title: 'Checkout errors',
    status: 'identified',
    impact: 'major',
    started_at: '2026-10-09T08:00:00Z',
    resolved_at: null,
    updated_at: '2026-10-09T08:30:00Z',
    components: [{ id: 'api', name: 'API', status: 'partial_outage' }],
    updates: [
      { id: 'u2', status: 'identified', message: 'Bad deploy <rolled back> & monitoring', created_at: '2026-10-09T08:30:00Z', components: { api: 'partial_outage' } },
      { id: 'u1', status: 'investigating', message: 'Looking into it', created_at: '2026-10-09T08:00:00Z' },
    ],
    postmortem: null,
    ...overrides,
  }
}

function maintenance(overrides: Partial<StatusMaintenance> = {}): StatusMaintenance {
  return {
    id: 'mw-1',
    title: 'Database upgrade',
    description: 'Postgres 17',
    status: 'scheduled',
    scheduled_start: '2026-10-12T22:00:00Z',
    scheduled_end: '2026-10-12T23:00:00Z',
    actual_start: null,
    actual_end: null,
    components: [{ id: 'db', name: 'Database' }],
    updates: [{ id: 'mu1', status: 'scheduled', message: 'Planned', created_at: '2026-10-05T10:00:00Z' }],
    ...overrides,
  }
}

function page(overrides: Partial<StatusPageData> = {}): StatusPageData {
  return {
    private: false,
    generated_at: '2026-10-09T09:00:00Z',
    project: {
      id: 'proj-1',
      name: 'Quillbase',
      slug: 'status',
      description: null,
      organization_slug: 'quillbase',
      organization_name: 'Quillbase',
      visibility: 'public',
      brand_color: null,
      logo_url: null,
      theme_default: 'system',
      timezone: 'Europe/Madrid',
      support_url: null,
      hide_powered_by: false,
      custom_domain: null,
      history_days: 90,
      bar_days: 90,
    },
    overall_status: 'partial_outage',
    groups: [{ id: 'g1', name: 'Data', position: 1, collapsed: true }],
    components: [component('api', 'API', { status: 'partial_outage' }), component('web', 'Website'), component('db', 'Database', { group_id: 'g1', status: 'maintenance' })],
    active_incidents: [incident()],
    maintenances: [maintenance(), maintenance({ id: 'mw-0', status: 'completed' })],
    recent_incidents: [],
    recent_maintenances: [],
    ...overrides,
  }
}

describe('view helpers', () => {
  it('joins names in plain English', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
    expect(joinNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more')
  })

  it('names what is affected in the overall sentence', () => {
    expect(overallSummary(page())).toEqual({
      status: 'partial_outage',
      headline: 'Partial outage',
      detail: 'API is affected and Database is under maintenance. Everything else is working normally.',
    })
    const calm = overallSummary(page({ overall_status: 'operational', components: [component('api', 'API')], active_incidents: [] }))
    expect(calm.detail).toBe('Every component is working normally.')
    expect(overallSummary(page({ components: [], active_incidents: [] })).detail).toBe('Nothing to report.')
  })

  it('puts loose components first and groups by position with their worst status', () => {
    const sections = componentSections(page())
    expect(sections.map((section) => [section.group?.name ?? null, section.status, section.components.length])).toEqual([
      [null, 'partial_outage', 2],
      ['Data', 'maintenance', 1],
    ])
  })

  it('computes short-window uptime with today counted up to now', () => {
    const now = new Date('2026-10-09T12:00:00Z')
    const days = [
      { date: '2026-10-08', status: 'operational' as const, downtime_minutes: 144, major_minutes: 0, partial_minutes: 0, degraded_minutes: 0, maintenance_minutes: 0, incidents: [] },
      { date: '2026-10-09', status: 'operational' as const, downtime_minutes: 0, major_minutes: 0, partial_minutes: 0, degraded_minutes: 0, maintenance_minutes: 0, incidents: [] },
    ]
    expect(windowUptime(days, 30, now, 'UTC')).toBeCloseTo(100 - (144 / (1440 + 720)) * 100, 6)
    expect(windowUptime([{ ...days[0]!, status: null }], 30, now)).toBeNull()
  })

  it('places incidents and maintenance on the local day they started', () => {
    const days = pastDays(
      page({ recent_maintenances: [maintenance({ status: 'completed', scheduled_start: '2026-10-06T22:30:00Z', actual_start: '2026-10-06T22:35:00Z' })] }),
      'Europe/Madrid',
      new Date('2026-10-09T09:00:00Z'),
    )
    expect(days[0]!.key).toBe('2026-10-09')
    expect(days[0]!.entries.map((entry) => entry.kind)).toEqual(['incident'])
    // 22:35 UTC is 00:35 the next day in Madrid.
    expect(days.find((day) => day.key === '2026-10-07')!.entries).toHaveLength(1)
    expect(days).toHaveLength(7)
  })

  it('colours updates by the statuses they asserted, then by impact', () => {
    expect(updateTone({ status: 'resolved', components: { api: 'major_outage' } }, 'critical')).toBe('operational')
    expect(updateTone({ status: 'identified', components: { api: 'degraded' } }, 'critical')).toBe('degraded')
    expect(updateTone({ status: 'identified' }, 'minor')).toBe('degraded')
    expect(updateTone({ status: 'identified' }, 'none')).toBe('none')
  })

  it('lists component changes by severity and skips unknown ids', () => {
    const changes = updateComponentChanges(
      { id: 'u', status: 'identified', message: '', created_at: '', components: { web: 'degraded', api: 'major_outage', ghost: 'major_outage' } },
      new Map([
        ['api', 'API'],
        ['web', 'Website'],
      ]),
    )
    expect(changes.map((change) => change.name)).toEqual(['API', 'Website'])
  })

  it('formats titles and durations', () => {
    expect(pageTitle({ name: 'Quillbase' })).toBe('Quillbase status')
    expect(pageTitle({ name: 'Quillbase Status' })).toBe('Quillbase Status')
    expect(durationBetween('2026-10-09T08:00:00Z', null)).toBeNull()
    expect(durationBetween('2026-10-09T08:00:00Z', '2026-10-09T08:38:00Z')).toBe('38 min')
    expect(durationBetween('2026-10-09T08:00:00Z', '2026-10-09T09:10:00Z')).toBe('1 h 10 min')
    expect(durationBetween('2026-10-09T08:00:00Z', '2026-10-12T10:00:00Z')).toBe('3 d 2 h')
  })
})

describe('feeds', () => {
  it('escapes markup and drops characters XML cannot carry', () => {
    expect(xmlEscape(`<a href="x">Tom's & co</a>\u0001`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom&apos;s &amp; co&lt;/a&gt;')
    expect(xmlEscape(null)).toBe('')
  })

  it('merges upcoming maintenance with history, newest first, without duplicates', () => {
    const history = [
      { kind: 'incident' as const, at: '2026-10-09T08:00:00Z', item: incident() },
      { kind: 'maintenance' as const, at: '2026-10-12T22:00:00Z', item: maintenance() },
    ]
    const entries = feedEntries(history, [maintenance()], LOCATION, APP)
    expect(entries.map((entry) => entry.url)).toEqual([`${APP}/status/quillbase/status/maintenance/mw-1`, `${APP}/status/quillbase/status/incidents/inc-1`])
    expect(entries[0]!.title).toBe('Maintenance: Database upgrade')
    expect(entries[1]!.summary).toContain('Affected: API (Partial outage).')
    expect(feedUpdated(entries, '2020-01-01T00:00:00Z')).toBe('2026-10-09T08:30:00.000Z')
    expect(feedEntries(history, [], LOCATION, APP, 1)).toHaveLength(1)
  })

  it('produces well-formed RSS and Atom with escaped content', () => {
    const doc: FeedDocument = {
      title: 'Quillbase <status>',
      description: 'Incidents & maintenance',
      pageUrl: `${APP}/status/quillbase/status`,
      selfUrl: `${APP}/status/quillbase/status/feed.rss`,
      author: 'Quillbase',
      updated: '2026-10-09T08:30:00.000Z',
      entries: feedEntries([{ kind: 'incident', at: '2026-10-09T08:00:00Z', item: incident() }], [], LOCATION, APP),
    }
    const rss = buildRss(doc)
    expect(rss).toContain('<title>Quillbase &lt;status&gt;</title>')
    expect(rss).toContain('Bad deploy &lt;rolled back&gt; &amp; monitoring')
    expect(rss).not.toContain('<rolled back>')
    expect(rss).toContain('<pubDate>Fri, 09 Oct 2026 08:00:00 GMT</pubDate>')
    const atom = buildAtom({ ...doc, entries: [] })
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(atom).not.toContain('<entry>')
  })
})

describe('Statuspage-compatible JSON', () => {
  it('maps the overall status to an indicator', () => {
    expect(buildStatusJson(page(), { location: LOCATION, appUrl: APP }).status).toEqual({ indicator: 'major', description: 'Partial outage' })
  })

  it('lists groups with their members, unresolved incidents and upcoming maintenance', () => {
    const summary = buildSummaryJson(page(), { location: LOCATION, appUrl: APP })
    expect(summary.page.url).toBe(`${APP}/status/quillbase/status`)
    const group = summary.components.find((entry) => entry.group === true)
    expect(group).toMatchObject({ id: 'g1', name: 'Data', status: 'under_maintenance', components: ['db'] })
    expect(summary.components.find((entry) => entry.id === 'api')).toMatchObject({ status: 'partial_outage', group_id: null })
    expect(summary.incidents).toHaveLength(1)
    expect(summary.incidents[0]!.incident_updates[0]!.affected_components).toEqual([{ code: 'api', name: 'API', new_status: 'partial_outage' }])
    expect(summary.incidents[0]!.monitoring_at).toBeNull()
    expect(summary.scheduled_maintenances.map((entry) => entry.id)).toEqual(['mw-1'])
    expect(summary.scheduled_maintenances[0]!.components[0]).toEqual({ id: 'db', name: 'Database', status: 'under_maintenance' })
  })
})
