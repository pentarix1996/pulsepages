'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

const PROJECT_TABLES = ['components', 'incidents', 'maintenances', 'monitors'] as const
const CHILD_TABLES = ['incident_updates', 'incident_components'] as const

/**
 * Refreshes Server Components when this project's data changes (Supabase Realtime, RLS applies), debounced so a
 * burst of changes causes one refresh. Also refreshes when the tab comes back after being hidden.
 */
export function RealtimeRefresh({ projectId, debounceMs = 800 }: { projectId: string; debounceMs?: number }) {
  const router = useRouter()
  const timer = useRef<number | null>(null)
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const schedule = () => {
      if (document.visibilityState === 'hidden') return
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => router.refresh(), debounceMs)
    }
    let channel = supabase.channel(`project:${projectId}`)
    for (const table of PROJECT_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `project_id=eq.${projectId}` }, schedule)
    }
    for (const table of CHILD_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
    }
    channel.subscribe()

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > 30_000) {
        hiddenAt.current = null
        router.refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer.current) window.clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [projectId, debounceMs, router])

  return null
}

/** Remembers the last opened status page so the sidebar and ⌘K default to it. */
export function RememberProject({ projectId }: { projectId: string }) {
  useEffect(() => {
    document.cookie = `upv_project=${projectId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
  }, [projectId])
  return null
}
