// Deterministic uptime ticks for the landing illustrations. The same seed gives the same bars on the server and the
// client, so hydration never disagrees.

export type Tick = 'up' | 'deg' | 'part' | 'major' | 'maint'

/** One tick per day. Mostly up, a few degraded or partial days, plus explicit events by index. */
export function seededTicks(seed: number, count: number, events: Readonly<Record<number, Tick>> = {}): Tick[] {
  let state = seed
  const ticks: Tick[] = []
  for (let index = 0; index < count; index += 1) {
    state = (state * 9301 + 49297) % 233280
    const roll = state / 233280
    ticks.push(roll > 0.985 ? 'part' : roll > 0.955 ? 'deg' : 'up')
  }
  for (const [index, tick] of Object.entries(events)) {
    const position = Number(index)
    if (position >= 0 && position < count) ticks[position] = tick
  }
  return ticks
}
