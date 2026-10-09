// Formatting helpers shared by the panel, the status page and emails rendered in Next. Pure and isomorphic.

export function formatDuration(totalSeconds: number | null | undefined, options: { compact?: boolean } = {}): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return '—'
  const seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest && !options.compact ? `${hours} h ${rest} min` : `${hours} h`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours && !options.compact ? `${days} d ${restHours} h` : `${days} d`
}

/** 99.962% — three decimals below 99.995, otherwise two, never rounding up to 100 unless exact. */
export function formatUptime(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value >= 100) return '100%'
  const decimals = value >= 99 ? 3 : 2
  const factor = 10 ** decimals
  return `${(Math.floor(value * factor) / factor).toFixed(decimals)}%`
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} s`
  return `${Math.round(value)} ms`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US')
}

function safeTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return 'UTC'
  }
}

export function formatDateTime(value: string | Date | null | undefined, options: { timeZone?: string; withZone?: boolean } = {}): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(options.timeZone),
    month: 'short',
    day: 'numeric',
    year: date.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: options.withZone ? 'short' : undefined,
  }).format(date)
}

export function formatDate(value: string | Date | null | undefined, options: { timeZone?: string; weekday?: boolean } = {}): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: value instanceof Date || (typeof value === 'string' && value.length > 10) ? safeTimeZone(options.timeZone) : 'UTC',
    weekday: options.weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function formatTime(value: string | Date | null | undefined, options: { timeZone?: string } = {}): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone(options.timeZone), hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return 'never'
  const date = typeof value === 'string' ? new Date(value) : value
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  if (Math.abs(seconds) < 45) return seconds > 5 ? 'in a few seconds' : 'just now'
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto', style: 'short' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === 'minute') return formatter.format(Math.round(seconds / size), unit)
  }
  return formatter.format(seconds, 'second')
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toUpperCase()
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`
}
