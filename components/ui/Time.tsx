'use client'

import { useSyncExternalStore } from 'react'
import { formatDateTime, formatRelative } from '@/lib/format'

// One shared timer per refresh interval, read through useSyncExternalStore: the server and the hydration pass see
// `null` (so markup matches), the client then gets the current time and a new value on every tick.
interface Clock {
  now: number
  listeners: Set<() => void>
  timer: number | null
  subscribe: (listener: () => void) => () => void
  read: () => number
}

const clocks = new Map<number, Clock>()

function clockFor(intervalMs: number): Clock {
  const existing = clocks.get(intervalMs)
  if (existing) return existing
  const clock: Clock = {
    now: Date.now(),
    listeners: new Set(),
    timer: null,
    subscribe(listener) {
      clock.listeners.add(listener)
      if (clock.timer === null) {
        clock.now = Date.now()
        clock.timer = window.setInterval(() => {
          clock.now = Date.now()
          for (const notify of clock.listeners) notify()
        }, intervalMs)
      }
      return () => {
        clock.listeners.delete(listener)
        if (clock.listeners.size === 0 && clock.timer !== null) {
          window.clearInterval(clock.timer)
          clock.timer = null
        }
      }
    },
    read: () => clock.now,
  }
  clocks.set(intervalMs, clock)
  return clock
}

const serverNow = () => null

/** Current time in ms, refreshed every `intervalMs`; null on the server and during hydration. */
export function useNow(intervalMs: number): number | null {
  const clock = clockFor(intervalMs)
  return useSyncExternalStore(clock.subscribe, clock.read, serverNow)
}

/** "3 min ago", refreshed every 30 seconds, with the exact time in the title. */
export function RelativeTime({ value, fallback = 'never' }: { value: string | null | undefined; fallback?: string }) {
  const now = useNow(30_000)
  if (!value) return <span>{fallback}</span>
  return (
    <time dateTime={value} title={formatDateTime(value, { withZone: true })} suppressHydrationWarning>
      {now !== null ? formatRelative(value, new Date(now)) : formatDateTime(value)}
    </time>
  )
}

/** Live elapsed time since `since` (hh:mm:ss under a day). */
export function Elapsed({ since }: { since: string }) {
  const now = useNow(1000)
  if (now === null) return <span className="mono num">—</span>
  const total = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000))
  const days = Math.floor(total / 86400)
  const hours = String(Math.floor((total % 86400) / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return <span className="mono num">{days > 0 ? `${days}d ${hours}:${minutes}` : `${hours}:${minutes}:${seconds}`}</span>
}
