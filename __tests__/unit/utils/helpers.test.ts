import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateTime,
  timeAgo,
  slugify,
  getStatusLabel,
  getStatusColor,
  getStatusDotClass,
  getOverallStatus,
  uptimePercentage,
  getSeverityBadgeVariant,
} from '@/lib/utils/helpers'
import type { Component, Incident } from '@/lib/types'

describe('formatDate', () => {
  it('formats a valid date string', () => {
    const result = formatDate('2026-01-15T10:00:00Z')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })

  it('returns empty string for null/undefined', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
  })

  it('returns empty string for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('')
  })
})

describe('formatDateTime', () => {
  it('formats a valid datetime with time', () => {
    const result = formatDateTime('2026-01-15T14:30:00Z')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
  })

  it('returns empty for null', () => {
    expect(formatDateTime(null)).toBe('')
  })
})

describe('timeAgo', () => {
  it('returns "just now" for recent times', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now')
  })

  it('returns empty for null', () => {
    expect(timeAgo(null)).toBe('')
  })

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(timeAgo(fiveMinAgo)).toBe('5m ago')
  })

  it('returns hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    expect(timeAgo(twoHoursAgo)).toBe('2h ago')
  })

  it('returns days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(timeAgo(threeDaysAgo)).toBe('3d ago')
  })
})

describe('slugify', () => {
  it('converts text to slug format', () => {
    expect(slugify('My Awesome API')).toBe('my-awesome-api')
  })

  it('removes special characters', () => {
    expect(slugify('Hello! World?')).toBe('hello-world')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('foo---bar')).toBe('foo-bar')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
  })
})

describe('getStatusLabel', () => {
  it('returns correct labels', () => {
    expect(getStatusLabel('operational')).toBe('Operational')
    expect(getStatusLabel('degraded')).toBe('Degraded Performance')
    expect(getStatusLabel('major_outage')).toBe('Major Outage')
    expect(getStatusLabel('maintenance')).toBe('Under Maintenance')
  })

  it('returns Unknown for invalid status', () => {
    expect(getStatusLabel('invalid' as never)).toBe('Unknown')
  })
})

describe('getStatusColor', () => {
  it('maps statuses to color names', () => {
    expect(getStatusColor('operational')).toBe('success')
    expect(getStatusColor('degraded')).toBe('warning')
    expect(getStatusColor('major_outage')).toBe('danger')
    expect(getStatusColor('maintenance')).toBe('info')
  })
})

describe('getStatusDotClass', () => {
  it('returns correct CSS class', () => {
    expect(getStatusDotClass('operational')).toBe('status-dot-operational')
    expect(getStatusDotClass('degraded')).toBe('status-dot-degraded')
    expect(getStatusDotClass('major_outage')).toBe('status-dot-down')
  })
})

describe('getOverallStatus', () => {
  it('returns operational for empty array', () => {
    expect(getOverallStatus([])).toBe('operational')
  })

  it('returns worst status - major_outage takes priority', () => {
    const components: Component[] = [
      { id: '1', project_id: 'p1', name: 'API', status: 'operational' },
      { id: '2', project_id: 'p1', name: 'DB', status: 'major_outage' },
    ]
    expect(getOverallStatus(components)).toBe('major_outage')
  })

  it('returns degraded when no outages', () => {
    const components: Component[] = [
      { id: '1', project_id: 'p1', name: 'API', status: 'operational' },
      { id: '2', project_id: 'p1', name: 'DB', status: 'degraded' },
    ]
    expect(getOverallStatus(components)).toBe('degraded')
  })

  it('returns operational when all operational', () => {
    const components: Component[] = [
      { id: '1', project_id: 'p1', name: 'API', status: 'operational' },
      { id: '2', project_id: 'p1', name: 'DB', status: 'operational' },
    ]
    expect(getOverallStatus(components)).toBe('operational')
  })
})

describe('uptimePercentage', () => {
  it('returns 100.00 for no incidents', () => {
    expect(uptimePercentage([])).toBe('100.00')
  })

  it('calculates uptime based on incidents with duration', () => {
    const incidents: Incident[] = [
      {
        id: '1', project_id: 'p1', title: 'Test', description: null,
        status: 'resolved', severity: 'warning', component_ids: [],
        duration: 60, created_at: new Date().toISOString(), incident_updates: [],
      },
    ]
    const result = parseFloat(uptimePercentage(incidents, 90))
    expect(result).toBeLessThan(100)
    expect(result).toBeGreaterThan(99)
  })
})

describe('getSeverityBadgeVariant', () => {
  it('returns success for resolved', () => {
    expect(getSeverityBadgeVariant('resolved', 'danger')).toBe('success')
  })

  it('returns danger for danger severity', () => {
    expect(getSeverityBadgeVariant('investigating', 'danger')).toBe('danger')
  })

  it('returns warning for warning severity', () => {
    expect(getSeverityBadgeVariant('investigating', 'warning')).toBe('warning')
  })

  it('returns info for info severity', () => {
    expect(getSeverityBadgeVariant('investigating', 'info')).toBe('info')
  })
})
