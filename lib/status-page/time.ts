// Times on the public status page are shown in the visitor's time zone (or the one they pick). The server renders
// them in the page's time zone; an inline script re-formats them with the visitor's zone before first paint and the
// client keeps them in sync afterwards. Both use formatStamp, so the text never jumps. Pure and isomorphic.

export type StampFormat =
  | 'time' //            16:21
  | 'time-tz' //         16:21 CEST
  | 'date' //            Sat 12 Oct
  | 'date-year' //       12 Oct 2026
  | 'date-full' //       Sat 12 Oct 2026
  | 'datetime' //        Sat 12 Oct, 16:21
  | 'datetime-tz' //     Sat 12 Oct, 16:21 CEST
  | 'datetime-full-tz' // Sat 12 Oct 2026, 16:21 CEST
  | 'end-tz' //          16:51 CEST, or Sun 13 Oct, 01:10 CEST when it ends on another day than `relativeTo`
  | 'dow' //             Sat
  | 'day' //             12
  | 'month-year' //      October 2026
  | 'zone' //            CEST

/**
 * Formats `iso` in `timeZone`. Deliberately self-contained (no imports, no outer variables, ES5 syntax inside): its
 * source is inlined into the page by StatusBootstrap so hard loads show the visitor's zone before the first paint.
 */
/* eslint-disable no-var -- ES5 on purpose, see above */
export function formatStamp(iso: string, format: string, timeZone: string, relativeTo?: string | null): string {
  var date = new Date(iso)
  if (isNaN(date.getTime())) return ''
  var zone = timeZone || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch (e) {
    zone = 'UTC'
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  function local(d: Date): { y: number; m: number; d: number; hh: string; mm: string; dow: number } {
    var list = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
    var map: Record<string, string> = {}
    for (var i = 0; i < list.length; i++) map[list[i]!.type] = list[i]!.value
    var y = parseInt(map.year!, 10)
    var m = parseInt(map.month!, 10)
    var day = parseInt(map.day!, 10)
    var hh = map.hour === '24' ? '00' : map.hour!
    return { y: y, m: m, d: day, hh: hh.length < 2 ? '0' + hh : hh, mm: map.minute!, dow: new Date(Date.UTC(y, m - 1, day)).getUTCDay() }
  }

  function zoneName(d: Date): string {
    if (zone === 'UTC' || zone === 'Etc/UTC' || zone === 'Etc/Universal' || zone === 'Universal' || zone === 'Etc/Zulu') return 'UTC'
    var locales = ['en-US', 'en-GB', 'en-AU', 'en-IN', 'en-NZ', 'en-ZA']
    var fallback = ''
    for (var i = 0; i < locales.length; i++) {
      var list = new Intl.DateTimeFormat(locales[i], { timeZone: zone, timeZoneName: 'short' }).formatToParts(d)
      for (var j = 0; j < list.length; j++) {
        if (list[j]!.type !== 'timeZoneName') continue
        var name = list[j]!.value
        if (!/^(GMT|UTC)[+\-−]/.test(name)) return name
        if (!fallback) fallback = name
      }
    }
    return fallback ? fallback.replace(/^GMT/, 'UTC').replace('−', '-') : 'UTC'
  }

  var p = local(date)
  var time = p.hh + ':' + p.mm
  var short = DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m - 1]
  switch (format) {
    case 'time':
      return time
    case 'time-tz':
      return time + ' ' + zoneName(date)
    case 'date':
      return short
    case 'date-year':
      return p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y
    case 'date-full':
      return short + ' ' + p.y
    case 'datetime':
      return short + ', ' + time
    case 'datetime-tz':
      return short + ', ' + time + ' ' + zoneName(date)
    case 'datetime-full-tz':
      return short + ' ' + p.y + ', ' + time + ' ' + zoneName(date)
    case 'end-tz': {
      var start = relativeTo ? new Date(relativeTo) : null
      if (start && !isNaN(start.getTime())) {
        var s = local(start)
        if (s.y === p.y && s.m === p.m && s.d === p.d) return time + ' ' + zoneName(date)
      }
      return short + ', ' + time + ' ' + zoneName(date)
    }
    case 'dow':
      return DAYS[p.dow]!
    case 'day':
      return String(p.d)
    case 'month-year':
      return MONTHS_LONG[p.m - 1] + ' ' + p.y
    case 'zone':
      return zoneName(date)
    default:
      return short + ', ' + time
  }
}
/* eslint-enable no-var */

/** The calendar date (YYYY-MM-DD) of `iso` in `timeZone`. */
export function localDateKey(iso: string | Date, timeZone: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  let zone = timeZone || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    zone = 'UTC'
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** "Thu 8 Oct" for a YYYY-MM-DD calendar date (no time zone involved). */
export function formatDayKey(dayKey: string, withYear = false): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  return formatStamp(date.toISOString(), withYear ? 'date-full' : 'date', 'UTC')
}

/** Shifts a YYYY-MM-DD date by `days`. */
export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10)
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Common zones offered in the time zone picker, besides the visitor's and the page's. */
export const COMMON_TIME_ZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'UTC',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Athens',
  'Africa/Johannesburg',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const

/** "Madrid", "New York", "UTC" for an IANA zone id. */
export function zoneCity(timeZone: string): string {
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return 'UTC'
  const last = timeZone.split('/').pop() ?? timeZone
  return last.replace(/_/g, ' ')
}

/** Current offset of a zone in minutes (for sorting the picker). */
export function zoneOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
    return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000)
  } catch {
    return 0
  }
}
