// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { csvCell, incidentTimings, incidentsCsv, toCsv, uptimeCsv } from '@/lib/domain/metrics'
import type { ProjectMetrics } from '@/lib/domain/types'

describe('csvCell', () => {
  it('leaves simple values alone', () => {
    expect(csvCell('Payments API')).toBe('Payments API')
    expect(csvCell(99.962)).toBe('99.962')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(true)).toBe('true')
  })

  it('writes empty cells for missing or non-finite values', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('quotes commas, quotes, line breaks and surrounding spaces (RFC 4180)', () => {
    expect(csvCell('Payments, EU')).toBe('"Payments, EU"')
    expect(csvCell('The "edge" cache')).toBe('"The ""edge"" cache"')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvCell('carriage\rreturn')).toBe('"carriage\rreturn"')
    expect(csvCell(' padded ')).toBe('" padded "')
  })

  it('neutralizes text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example")')).toBe('"\'=HYPERLINK(""http://evil.example"")"')
    expect(csvCell('+1 incident')).toBe("'+1 incident")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tindented')).toBe("'\tindented")
    // Numbers are numbers, even negative ones
    expect(csvCell(-5)).toBe('-5')
  })

  it('formats dates as ISO 8601', () => {
    expect(csvCell(new Date('2026-10-09T14:30:00Z'))).toBe('2026-10-09T14:30:00.000Z')
  })
})

describe('toCsv', () => {
  it('uses CRLF line endings and ends with a newline', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y'], [null, 'z']])).toBe('a,b\r\n1,"x,y"\r\n,z\r\n')
  })
})

const metrics: ProjectMetrics = {
  from: '2026-09-01T00:00:00Z',
  to: '2026-10-01T00:00:00Z',
  uptime: 99.95,
  components: [
    { id: 'c1', name: 'Payments, EU', slug: 'payments-eu', status: 'operational', uptime: 99.9, downtime_seconds: 2592, major_seconds: 1800, partial_seconds: 2640, degraded_seconds: 600, maintenance_seconds: 3600 },
  ],
  incidents: {
    total: 2,
    by_impact: { major: 1, minor: 1 },
    mtta_seconds: 120,
    mttr_seconds: 1800,
    longest_seconds: 2400,
    list: [
      { id: 'i1', title: '=Failed "card" payments', impact: 'major', status: 'resolved', detected_at: '2026-09-10T10:00:00Z', acknowledged_at: '2026-09-10T10:02:00Z', resolved_at: '2026-09-10T10:40:00Z', duration_seconds: 2400 },
      { id: 'i2', title: 'Slow dashboard', impact: 'minor', status: 'monitoring', detected_at: '2026-09-30T23:00:00Z', acknowledged_at: null, resolved_at: null, duration_seconds: 3600 },
    ],
  },
  slos: [],
}

describe('report CSVs', () => {
  it('exports uptime per component with minutes per status and a total row', () => {
    const lines = uptimeCsv(metrics).split('\r\n')
    expect(lines[0]).toBe('component,key,current_status,uptime_percent,weighted_downtime_minutes,major_outage_minutes,partial_outage_minutes,degraded_minutes,maintenance_minutes,from,to')
    expect(lines[1]).toBe('"Payments, EU",payments-eu,operational,99.9,43.2,30,44,10,60,2026-09-01T00:00:00Z,2026-10-01T00:00:00Z')
    expect(lines[2]).toBe('All components,,,99.95,,,,,,2026-09-01T00:00:00Z,2026-10-01T00:00:00Z')
    expect(lines[3]).toBe('')
  })

  it('exports incidents with acknowledgement, resolution and public duration', () => {
    const lines = incidentsCsv(metrics, { i1: '2026-09-10T10:05:00Z' }).split('\r\n')
    expect(lines[1]).toBe(`i1,"'=Failed ""card"" payments",major,resolved,2026-09-10T10:00:00Z,2026-09-10T10:05:00Z,2026-09-10T10:02:00Z,2026-09-10T10:40:00Z,2,40,35`)
    // Still open: duration runs to the end of the period, no time to resolve
    expect(lines[2]).toBe('i2,Slow dashboard,minor,monitoring,2026-09-30T23:00:00Z,,,,,,60')
  })

  it('computes incident timings from detection and publication', () => {
    expect(incidentTimings({ detected_at: '2026-09-10T10:00:00Z', acknowledged_at: '2026-09-10T10:02:00Z', resolved_at: '2026-09-10T10:40:00Z' }, '2026-09-10T10:05:00Z', '2026-10-01T00:00:00Z')).toEqual({
      acknowledge_seconds: 120,
      resolve_seconds: 2400,
      duration_seconds: 2100,
    })
  })
})
