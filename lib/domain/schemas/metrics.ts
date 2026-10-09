// Metrics, uptime and SLOs: query/input validation, API resources and report periods. Pure and isomorphic.
import { z } from 'zod'
import { componentStatus, incidentImpact, incidentStatus, name, nullable, timestamp, uuid } from './common'

/** get_project_metrics() is asked for at most this many days at once. */
export const MAX_METRICS_RANGE_DAYS = 400

const isoDate = z.iso.date({ error: 'Use a date such as 2026-10-01 or an ISO 8601 date-time.' })

export const metricsQuery = z.object({
  from: z.union([timestamp, isoDate], { error: 'Use an ISO 8601 date (2026-10-01) or date-time (2026-10-01T00:00:00Z).' }).optional().describe('Start (inclusive). ISO 8601 date-time, or a date read as 00:00 UTC. Default: 30 days before `to`.'),
  to: z.union([timestamp, isoDate], { error: 'Use an ISO 8601 date (2026-10-01) or date-time (2026-10-01T00:00:00Z).' }).optional().describe('End (exclusive), at most now. Default: now.'),
})
export type MetricsQuery = z.infer<typeof metricsQuery>

export const uptimeQuery = z.object({
  days: z.coerce.number({ error: 'days must be a number.' }).int('days must be a whole number.').min(1, 'Use 1 to 365 days.').max(365, 'Use 1 to 365 days.').default(90).describe('Number of days, 1-365 (default 90).'),
})

// ------------------------------------------------------------------ SLOs
export const SLO_WINDOWS = [7, 14, 28, 30, 90] as const
export type SloWindow = (typeof SLO_WINDOWS)[number]

const sloWindow = z.union(SLO_WINDOWS.map((days) => z.literal(days)) as [z.ZodLiteral<7>, z.ZodLiteral<14>, z.ZodLiteral<28>, z.ZodLiteral<30>, z.ZodLiteral<90>], {
  error: 'Use a window of 7, 14, 28, 30 or 90 days.',
})

export const sloTarget = z
  .number({ error: 'Enter the target as a percentage, such as 99.9.' })
  .gt(0, 'Use a target above 0 and below 100.')
  .lt(100, 'Use a target above 0 and below 100.')
  .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, 'Use at most three decimals.')
  .describe('Percentage, exclusive of 0 and 100 (e.g. 99.9).')

const sloComponent = nullable(z.string().trim().min(1)).describe('Component id or key. Null or omitted: every component of the page.')

export const sloCreateInput = z.object({
  name: name(80),
  target: sloTarget,
  window_days: sloWindow.default(30).describe('Rolling window in days.'),
  component_id: sloComponent.optional(),
})
export type SloCreateInput = z.infer<typeof sloCreateInput>

export const sloUpdateInput = z.object({
  name: name(80).optional(),
  target: sloTarget.optional(),
  window_days: sloWindow.optional(),
  component_id: sloComponent.optional(),
})
export type SloUpdateInput = z.infer<typeof sloUpdateInput>

// ------------------------------------------------------------------ responses
export const sloResource = z.object({
  id: uuid,
  name: z.string(),
  target: z.number(),
  window_days: z.number().int(),
  component_id: uuid.nullable(),
  actual: z.number().nullable().describe('Measured availability over the window, in percent.'),
  budget_remaining: z.number().nullable().describe('Share of the error budget left, 0-1.'),
  allowed_downtime_seconds: z.number().nullable(),
  consumed_downtime_seconds: z.number().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
})
export type SloResource = z.infer<typeof sloResource>

const sloStatus = z.object({
  id: uuid,
  name: z.string(),
  target: z.number(),
  window_days: z.number().int(),
  component_id: uuid.nullable(),
  actual: z.number(),
  allowed_downtime_seconds: z.number(),
  consumed_downtime_seconds: z.number(),
  budget_remaining: z.number(),
})

export const projectMetricsResource = z.object({
  from: timestamp,
  to: timestamp,
  uptime: z.number().describe('Average uptime of the components, in percent.'),
  components: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      slug: z.string(),
      status: componentStatus,
      uptime: z.number(),
      downtime_seconds: z.number().describe('Weighted downtime (major 100 %, partial and degraded by the page weights).'),
      major_seconds: z.number(),
      partial_seconds: z.number(),
      degraded_seconds: z.number(),
      maintenance_seconds: z.number(),
    }),
  ),
  incidents: z.object({
    total: z.number().int(),
    by_impact: z.record(z.string(), z.number().int()).describe('Incident count per impact.'),
    mtta_seconds: z.number().nullable().describe('Mean time from detection to acknowledgement.'),
    mttr_seconds: z.number().nullable().describe('Mean time from detection to resolution.'),
    longest_seconds: z.number().nullable(),
    list: z.array(
      z.object({
        id: uuid,
        title: z.string(),
        impact: incidentImpact,
        status: incidentStatus,
        detected_at: timestamp,
        acknowledged_at: timestamp.nullable(),
        resolved_at: timestamp.nullable(),
        duration_seconds: z.number(),
      }),
    ),
  }),
  slos: z.array(sloStatus),
})

export const componentUptimeResource = z.object({
  component_id: uuid,
  slug: z.string(),
  name: z.string(),
  uptime: z.number().describe('Uptime over the requested days, in percent.'),
  days: z.array(
    z.object({
      date: z.string().describe('Day in the status page time zone (YYYY-MM-DD).'),
      status: componentStatus.nullable().describe('Worst status that day; null before the component existed.'),
      downtime_minutes: z.number(),
    }),
  ),
})
export type ComponentUptimeResource = z.infer<typeof componentUptimeResource>

// ------------------------------------------------------------------ report periods
export const REPORT_PERIODS = ['7d', '30d', '90d'] as const
export type ReportPeriodKey = (typeof REPORT_PERIODS)[number]
const PERIOD_DAYS: Record<ReportPeriodKey, number> = { '7d': 7, '30d': 30, '90d': 90 }
export const REPORT_PERIOD_LABELS: Record<ReportPeriodKey, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' }

export interface ReportPeriod {
  kind: 'rolling' | 'month'
  /** `7d`, `30d`, `90d` or `YYYY-MM`. */
  key: string
  /** Calendar month (YYYY-MM) for monthly periods. */
  month: string | null
  from: Date
  to: Date
  /** Length of the full period in days (a calendar month counts all its days). */
  days: number
  label: string
  /** A month that has not finished yet (`to` is now). */
  partial: boolean
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') }
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (positive east of Greenwich). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const local = zonedParts(date, timeZone)
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** UTC instant of 00:00 on `year-month-day` in `timeZone` (month is 1-12; overflowing values roll over). */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day)
  const first = guess - zoneOffsetMs(new Date(guess), timeZone)
  const second = guess - zoneOffsetMs(new Date(first), timeZone)
  return new Date(second)
}

/** YYYY-MM of `date` in `timeZone`. */
export function monthOf(date: Date, timeZone: string): string {
  const { year, month } = zonedParts(date, timeZone)
  return `${year}-${String(month).padStart(2, '0')}`
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)))
}

/** Start and end of a calendar month in `timeZone`; null for malformed or future months. */
export function monthRange(month: string, timeZone: string, now: Date = new Date()): { from: Date; to: Date; days: number; partial: boolean; label: string } | null {
  const match = MONTH_PATTERN.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const index = Number(match[2])
  if (year < 2000 || year > 2100) return null
  const from = zonedMidnight(year, index, 1, timeZone)
  if (from.getTime() > now.getTime()) return null
  const end = zonedMidnight(year, index + 1, 1, timeZone)
  const partial = end.getTime() > now.getTime()
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate()
  return { from, to: partial ? now : end, days, partial, label: monthLabel(year, index) }
}

/** The last complete calendar month in `timeZone` (YYYY-MM). */
export function previousMonth(timeZone: string, now: Date = new Date()): string {
  const { year, month } = zonedParts(now, timeZone)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

/** The current month and the `count - 1` before it, newest first, for month pickers. */
export function recentMonths(timeZone: string, now: Date = new Date(), count = 12): Array<{ value: string; label: string; partial: boolean }> {
  const { year, month } = zonedParts(now, timeZone)
  const list: Array<{ value: string; label: string; partial: boolean }> = []
  for (let offset = 0; offset < count; offset++) {
    const total = year * 12 + (month - 1) - offset
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    list.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: monthLabel(y, m), partial: offset === 0 })
  }
  return list
}

/**
 * Reads `?period=7d|30d|90d` or `?month=YYYY-MM` (calendar month in the page time zone). Invalid or future values
 * fall back to the last 30 days.
 */
export function parseReportPeriod(input: { period?: string | null; month?: string | null }, timeZone: string, now: Date = new Date()): ReportPeriod {
  if (input.month) {
    const range = monthRange(input.month, timeZone, now)
    if (range) {
      return { kind: 'month', key: input.month, month: input.month, from: range.from, to: range.to, days: range.days, label: range.partial ? `${range.label} (to date)` : range.label, partial: range.partial }
    }
  }
  const key: ReportPeriodKey = (REPORT_PERIODS as readonly string[]).includes(input.period ?? '') ? (input.period as ReportPeriodKey) : '30d'
  const days = PERIOD_DAYS[key]
  return { kind: 'rolling', key, month: null, from: new Date(now.getTime() - days * 86_400_000), to: now, days, label: REPORT_PERIOD_LABELS[key], partial: false }
}
