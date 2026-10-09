'use client'

import { useEffect, useState } from 'react'
import { formatDateTime, formatRelative } from '@/lib/format'

/** "3 min ago", refreshed every 30 seconds, with the exact time in the title. */
export function RelativeTime({ value, fallback = 'never' }: { value: string | null | undefined; fallback?: string }) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  if (!value) return <span>{fallback}</span>
  return (
    <time dateTime={value} title={formatDateTime(value, { withZone: true })} suppressHydrationWarning>
      {now ? formatRelative(value, now) : formatDateTime(value)}
    </time>
  )
}

/** Live elapsed time since `since` (hh:mm:ss under a day). */
export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (now === null) return <span className="mono num">—</span>
  const total = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000))
  const days = Math.floor(total / 86400)
  const hours = String(Math.floor((total % 86400) / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return <span className="mono num">{days > 0 ? `${days}d ${hours}:${minutes}` : `${hours}:${minutes}:${seconds}`}</span>
}
