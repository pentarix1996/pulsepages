// Wall-clock times in the status page's time zone <-> ISO instants, for <input type="datetime-local">.
// Pure and isomorphic so forms and tests share it.

function partsIn(at: number, timeZone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** Offset of a time zone from UTC at an instant, in minutes (Europe/Madrid in summer: 120). */
export function zoneOffsetMinutes(at: number, timeZone: string): number {
  const p = partsIn(at, timeZone)
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000) / 60000)
}

const pad = (value: number) => String(value).padStart(2, '0')

/** ISO instant → "YYYY-MM-DDTHH:mm" as shown on a wall clock in `timeZone`. */
export function toZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return ''
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return ''
  const p = partsIn(at, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** "YYYY-MM-DDTHH:mm" on a wall clock in `timeZone` → ISO instant (null when the value is not a date-time). */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number]
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let at = wall - zoneOffsetMinutes(wall, timeZone) * 60000
  // Near a DST change the offset at the guess can differ from the offset at the result; one correction settles it.
  const corrected = wall - zoneOffsetMinutes(at, timeZone) * 60000
  if (corrected !== at) at = corrected
  return new Date(at).toISOString()
}

/** Rounds up to the next quarter hour, then adds `hours` (default start for a new window). */
export function nextQuarterHour(now: number, hours = 0): string {
  const quarter = 15 * 60000
  return new Date(Math.ceil(now / quarter) * quarter + hours * 3600000).toISOString()
}
