'use client'

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { formatStamp, isValidTimeZone, type StampFormat } from '@/lib/status-page/time'
import { InlineScript } from './InlineScript'
import { TIME_ZONE_STORAGE_KEY } from './storage'

// ------------------------------------------------------------------
// Visitor time zone: chosen in the footer, else the browser's. The page's own zone is what the server renders.
// ------------------------------------------------------------------
declare global {
  interface Window {
    __upvTz?: string
  }
}

const listeners = new Set<() => void>()
let current: string | null = null

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function readStoredTimeZone(): string | null {
  try {
    const stored = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY)
    return stored && isValidTimeZone(stored) ? stored : null
  } catch {
    return null
  }
}

function visitorTimeZone(): string {
  if (current === null) current = (window.__upvTz && isValidTimeZone(window.__upvTz) ? window.__upvTz : null) ?? readStoredTimeZone() ?? browserTimeZone()
  return current
}

export function setVisitorTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) return
  current = timeZone
  window.__upvTz = timeZone
  try {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, timeZone)
  } catch {
    // Private mode: the choice lasts for this page view.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const PageTimeZoneContext = createContext<string>('UTC')

/** Provides the page's own time zone: what the server renders before the visitor's zone is known. */
export function PageTimeZone({ timeZone, children }: { timeZone: string; children: ReactNode }) {
  return <PageTimeZoneContext.Provider value={timeZone}>{children}</PageTimeZoneContext.Provider>
}

/** The zone times are shown in: the page's zone on the server and during hydration, the visitor's afterwards. */
export function useStatusTimeZone(): string {
  const pageZone = useContext(PageTimeZoneContext)
  return useSyncExternalStore(subscribe, visitorTimeZone, () => pageZone)
}

/** The page's own time zone (for labels such as "Status page time"). */
export function usePageTimeZone(): string {
  return useContext(PageTimeZoneContext)
}

/**
 * A timestamp in the visitor's time zone. On hard loads the inline script right after the element re-formats it
 * before the first paint; React then keeps it in sync when the visitor picks another zone.
 */
export function LocalTime({ value, format = 'datetime-tz', relativeTo, className }: { value: string; format?: StampFormat; relativeTo?: string | null; className?: string }) {
  const timeZone = useStatusTimeZone()
  return (
    <>
      <time dateTime={value} data-f={format} data-rel={relativeTo ?? undefined} className={className} suppressHydrationWarning>
        {formatStamp(value, format, timeZone, relativeTo)}
      </time>
      <InlineScript code="window.__upvT&&window.__upvT(document.currentScript)" />
    </>
  )
}
