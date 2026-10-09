'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CommandPalette } from './CommandPalette'
import { Sidebar } from './Sidebar'
import type { ShellCounts, ShellOrganization, ShellProject, ShellUser } from './types'

export function PanelShell({ user, organizations, projects, counts, lastProjectId, children }: { user: ShellUser; organizations: ShellOrganization[]; projects: ShellProject[]; counts: ShellCounts; lastProjectId: string | null; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const close = useCallback(() => setPaletteOpen(false), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="shell">
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <Sidebar user={user} organizations={organizations} projects={projects} counts={counts} lastProjectId={lastProjectId} onOpenPalette={() => setPaletteOpen(true)} />
      <main className="main" id="main">
        {children}
      </main>
      <CommandPalette open={paletteOpen} onClose={close} projects={projects} lastProjectId={lastProjectId} />
    </div>
  )
}
