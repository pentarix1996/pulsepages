'use client'

import { useId, useMemo, useSyncExternalStore } from 'react'
import { ChevronDownIcon } from '@/components/ui/icons'
import { COMMON_TIME_ZONES, formatStamp, zoneCity, zoneOffsetMinutes } from '@/lib/status-page/time'
import { browserTimeZone, setVisitorTimeZone, usePageTimeZone, useStatusTimeZone } from './LocalTime'

const noop = () => () => {}

/**
 * "Show times in" picker. Rendered after hydration only (labels depend on the browser's zone data), in a box of the
 * same size so the footer does not move.
 */
export function TimeZoneSelect() {
  const id = useId()
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const pageZone = usePageTimeZone()
  const current = useStatusTimeZone()

  const options = useMemo(() => {
    if (!mounted) return []
    const now = new Date()
    const browser = browserTimeZone()
    const zones = [...new Set<string>([browser, pageZone, current, ...COMMON_TIME_ZONES])]
    return zones
      .map((zone) => {
        const notes = [zone === browser ? 'your time' : null, zone === pageZone && zone !== browser ? 'page time' : null].filter(Boolean)
        const abbreviation = formatStamp(now.toISOString(), 'zone', zone)
        const city = zoneCity(zone)
        const label = city === abbreviation ? city : `${city} (${abbreviation})`
        return { value: zone, label: notes.length ? `${label} · ${notes.join(', ')}` : label, offset: zoneOffsetMinutes(zone, now) }
      })
      .sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label))
  }, [mounted, pageZone, current])

  return (
    <div className="sp-tz">
      <label htmlFor={id}>Show times in</label>
      <span className="sp-select-wrap">
        {mounted ? (
          <select id={id} className="sp-select" value={current} onChange={(event) => setVisitorTimeZone(event.target.value)}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <select id={id} className="sp-select" disabled aria-busy="true" defaultValue="">
            <option value="">{zoneCity(pageZone)}</option>
          </select>
        )}
        <ChevronDownIcon size={14} />
      </span>
    </div>
  )
}
