'use client'

import { useLayoutEffect, useSyncExternalStore } from 'react'
import type { Theme } from '@shared/domain.ts'
import { MoonIcon, SunIcon } from '@/components/ui/icons'
import { STATUS_ROOT_ATTRIBUTE, themeStorageKey } from './storage'

const listeners = new Set<() => void>()
const DARK_QUERY = '(prefers-color-scheme: dark)'

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${STATUS_ROOT_ATTRIBUTE}]`)
}

function isDark(): boolean {
  return root()?.classList.contains('dark') ?? false
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  listeners.forEach((listener) => listener())
}

function storedTheme(projectId: string): 'light' | 'dark' | null {
  try {
    const value = window.localStorage.getItem(themeStorageKey(projectId))
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

/** Same rule as the inline bootstrap script: visitor's choice, else the page default, else the system setting. */
function preferredDark(projectId: string, themeDefault: Theme): boolean {
  const stored = storedTheme(projectId)
  if (stored) return stored === 'dark'
  if (themeDefault === 'system') return window.matchMedia?.(DARK_QUERY).matches ?? false
  return themeDefault === 'dark'
}

/**
 * Light/dark switch. Both icons are rendered and CSS shows the right one from the root's `.dark` class, so nothing
 * flips after hydration. The choice is stored per page.
 */
export function ThemeToggle({ projectId, themeDefault }: { projectId: string; themeDefault: Theme }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => themeDefault === 'dark')

  // Soft navigations render the page root from the server again: re-apply the preference before paint, and follow
  // the system setting while the visitor has not chosen.
  useLayoutEffect(() => {
    const apply = () => {
      root()?.classList.toggle('dark', preferredDark(projectId, themeDefault))
      notify()
    }
    apply()
    if (themeDefault !== 'system' || !window.matchMedia) return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      if (!storedTheme(projectId)) apply()
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [projectId, themeDefault])

  function toggle() {
    const element = root()
    if (!element) return
    const next = !element.classList.contains('dark')
    element.classList.toggle('dark', next)
    try {
      window.localStorage.setItem(themeStorageKey(projectId), next ? 'dark' : 'light')
    } catch {
      // Private mode: the choice lasts for this page view.
    }
    notify()
  }

  return (
    <button type="button" className="sp-icon-btn sp-theme-toggle" onClick={toggle} aria-pressed={dark} aria-label="Dark theme" title={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      <SunIcon size={18} className="sp-theme-sun" />
      <MoonIcon size={18} className="sp-theme-moon" />
    </button>
  )
}
