// Time formatting for the overview and reports. Everything is rendered in the status page time zone so server and
// browser output match (no hydration drift) and the whole team reads the same clock.
import { regionInfo } from '@shared/regions.ts'

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return 'UTC'
  }
}

/** 16:21 or 16:21:04 */
export function clockTime(value: string | Date, timeZone: string, withSeconds = false): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone: safeZone(timeZone), hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hourCycle: 'h23' }).format(date)
}

/** "CEST", "EDT", or "GMT+5:30" when the zone has no common abbreviation. */
export function zoneAbbreviation(timeZone: string, at: string | Date = new Date()): string {
  const date = typeof at === 'string' ? new Date(at) : at
  const zone = safeZone(timeZone)
  const pick = (locale: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? ''
  const us = pick('en-US')
  if (us && !us.startsWith('GMT')) return us
  const gb = pick('en-GB')
  if (gb && !gb.startsWith('GMT') && !gb.startsWith('UTC')) return gb
  return us || 'UTC'
}

function sameDay(a: Date, b: Date, timeZone: string): boolean {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: safeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' })
  return format.format(a) === format.format(b)
}

/** "16:02" today, "Oct 8, 16:02" otherwise. */
export function shortMoment(value: string, timeZone: string, now: Date): string {
  const date = new Date(value)
  if (sameDay(date, now, timeZone)) return clockTime(date, timeZone)
  const day = new Intl.DateTimeFormat('en-US', { timeZone: safeZone(timeZone), month: 'short', day: 'numeric' }).format(date)
  return `${day}, ${clockTime(date, timeZone)}`
}

/** Day tile for a maintenance window: { weekday: 'Sat', day: '12', month: 'Oct' } */
export function dayTile(value: string, timeZone: string): { weekday: string; day: string; month: string } {
  const date = new Date(value)
  const zone = safeZone(timeZone)
  return {
    weekday: new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(date),
    day: new Intl.DateTimeFormat('en-US', { timeZone: zone, day: 'numeric' }).format(date),
    month: new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short' }).format(date),
  }
}

/** "04:00–04:30 CEST", or "Oct 12, 23:00 – Oct 13, 01:00 CEST" across days. */
export function timeRange(start: string, end: string, timeZone: string): string {
  const from = new Date(start)
  const to = new Date(end)
  const zone = zoneAbbreviation(timeZone, from)
  if (sameDay(from, to, timeZone)) return `${clockTime(from, timeZone)}–${clockTime(to, timeZone)} ${zone}`
  const day = (date: Date) => new Intl.DateTimeFormat('en-US', { timeZone: safeZone(timeZone), month: 'short', day: 'numeric' }).format(date)
  return `${day(from)}, ${clockTime(from, timeZone)} – ${day(to)}, ${clockTime(to, timeZone)} ${zone}`
}

/** "every 30 seconds", "every minute", "every 5 minutes", "every hour". */
export function everyInterval(seconds: number): string {
  if (seconds < 60) return `every ${seconds} seconds`
  if (seconds === 60) return 'every minute'
  if (seconds < 3600) return seconds % 60 === 0 ? `every ${seconds / 60} minutes` : `every ${seconds} seconds`
  if (seconds === 3600) return 'every hour'
  return seconds % 3600 === 0 ? `every ${seconds / 3600} hours` : `every ${Math.round(seconds / 60)} minutes`
}

/** Short lowercase region code for dense rows ("fra"), with the city for the title. */
export function regionCode(region: string | null): { code: string; city: string } {
  if (!region) return { code: '—', city: 'Unknown region' }
  const info = regionInfo(region)
  return info ? { code: info.short.toLowerCase(), city: `${info.city} (${region})` } : { code: region.slice(0, 3), city: region }
}

/** Reminder lead time: 1440 → "24 hours", 90 → "90 minutes". */
export function leadTime(minutes: number): string {
  if (minutes % 1440 === 0 && minutes >= 1440) return minutes === 1440 ? '24 hours' : `${minutes / 1440} days`
  if (minutes % 60 === 0 && minutes >= 60) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`
  return `${minutes} minutes`
}
