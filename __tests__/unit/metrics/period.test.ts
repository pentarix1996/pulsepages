// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { monthOf, monthRange, parseReportPeriod, previousMonth, recentMonths, zonedMidnight } from '@/lib/domain/schemas/metrics'

const NOW = new Date('2026-10-09T14:30:00Z')

describe('zonedMidnight', () => {
  it('finds local midnight across offsets and daylight saving time', () => {
    expect(zonedMidnight(2026, 10, 1, 'Europe/Madrid').toISOString()).toBe('2026-09-30T22:00:00.000Z')
    expect(zonedMidnight(2026, 11, 1, 'Europe/Madrid').toISOString()).toBe('2026-10-31T23:00:00.000Z')
    expect(zonedMidnight(2026, 3, 29, 'Europe/Madrid').toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(zonedMidnight(2026, 10, 1, 'America/New_York').toISOString()).toBe('2026-10-01T04:00:00.000Z')
    expect(zonedMidnight(2026, 10, 1, 'Asia/Kolkata').toISOString()).toBe('2026-09-30T18:30:00.000Z')
    expect(zonedMidnight(2026, 10, 1, 'UTC').toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('rolls over month 13 into January', () => {
    expect(zonedMidnight(2026, 13, 1, 'UTC').toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('parseReportPeriod', () => {
  it('defaults to the last 30 days', () => {
    const period = parseReportPeriod({}, 'Europe/Madrid', NOW)
    expect(period).toMatchObject({ kind: 'rolling', key: '30d', days: 30, label: 'Last 30 days', month: null })
    expect(period.to).toEqual(NOW)
    expect(NOW.getTime() - period.from.getTime()).toBe(30 * 86_400_000)
  })

  it('reads 7 and 90 day periods and ignores unknown ones', () => {
    expect(parseReportPeriod({ period: '7d' }, 'UTC', NOW)).toMatchObject({ key: '7d', days: 7, label: 'Last 7 days' })
    expect(parseReportPeriod({ period: '90d' }, 'UTC', NOW)).toMatchObject({ key: '90d', days: 90 })
    expect(parseReportPeriod({ period: '365d' }, 'UTC', NOW)).toMatchObject({ key: '30d' })
    expect(parseReportPeriod({ period: '7d; drop' }, 'UTC', NOW)).toMatchObject({ key: '30d' })
  })

  it('reads a complete calendar month in the page time zone', () => {
    const period = parseReportPeriod({ month: '2026-09' }, 'Europe/Madrid', NOW)
    expect(period).toMatchObject({ kind: 'month', key: '2026-09', month: '2026-09', days: 30, label: 'September 2026', partial: false })
    expect(period.from.toISOString()).toBe('2026-08-31T22:00:00.000Z')
    expect(period.to.toISOString()).toBe('2026-09-30T22:00:00.000Z')
  })

  it('ends the current month now and says so', () => {
    const period = parseReportPeriod({ month: '2026-10' }, 'Europe/Madrid', NOW)
    expect(period).toMatchObject({ kind: 'month', days: 31, partial: true, label: 'October 2026 (to date)' })
    expect(period.from.toISOString()).toBe('2026-09-30T22:00:00.000Z')
    expect(period.to).toEqual(NOW)
  })

  it('a month wins over a rolling period; future or malformed months fall back', () => {
    expect(parseReportPeriod({ month: '2026-08', period: '7d' }, 'UTC', NOW)).toMatchObject({ key: '2026-08' })
    expect(parseReportPeriod({ month: '2026-11' }, 'UTC', NOW)).toMatchObject({ key: '30d' })
    expect(parseReportPeriod({ month: '2026-13' }, 'UTC', NOW)).toMatchObject({ key: '30d' })
    expect(parseReportPeriod({ month: '26-09' }, 'UTC', NOW)).toMatchObject({ key: '30d' })
    expect(parseReportPeriod({ month: '1999-01' }, 'UTC', NOW)).toMatchObject({ key: '30d' })
  })

  it('knows February lengths', () => {
    expect(monthRange('2028-02', 'UTC', NOW)).toBeNull()
    expect(monthRange('2024-02', 'UTC', NOW)?.days).toBe(29)
    expect(monthRange('2026-02', 'UTC', NOW)?.days).toBe(28)
  })
})

describe('month helpers', () => {
  it('uses the page time zone to decide the current month', () => {
    const lateOnSeptember30InUtc = new Date('2026-09-30T23:30:00Z')
    expect(monthOf(lateOnSeptember30InUtc, 'UTC')).toBe('2026-09')
    expect(monthOf(lateOnSeptember30InUtc, 'Europe/Madrid')).toBe('2026-10')
  })

  it('the default SLA month is the last complete one', () => {
    expect(previousMonth('Europe/Madrid', NOW)).toBe('2026-09')
    expect(previousMonth('UTC', new Date('2026-01-15T12:00:00Z'))).toBe('2025-12')
  })

  it('lists recent months newest first', () => {
    const months = recentMonths('UTC', NOW, 3)
    expect(months).toEqual([
      { value: '2026-10', label: 'October 2026', partial: true },
      { value: '2026-09', label: 'September 2026', partial: false },
      { value: '2026-08', label: 'August 2026', partial: false },
    ])
    expect(recentMonths('UTC', new Date('2026-01-10T00:00:00Z'), 2).map((month) => month.value)).toEqual(['2026-01', '2025-12'])
  })
})
