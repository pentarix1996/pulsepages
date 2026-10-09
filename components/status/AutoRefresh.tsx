'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Keeps an open status page current during an outage: re-renders from the server every `seconds` while the tab is
 * visible, and right away when the visitor comes back to a stale tab. Client state (open groups, popover) is kept.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    let last = Date.now()
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      last = Date.now()
      router.refresh()
    }
    const timer = window.setInterval(refresh, seconds * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > seconds * 1000) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router, seconds])
  return null
}
