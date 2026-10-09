'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  ArrowRightIcon,
  CalendarIcon,
  IncidentIcon,
  KeyIcon,
  LayersIcon,
  MonitorIcon,
  PlusIcon,
  StatusPageIcon,
  UsersIcon,
  type IconProps,
} from '@/components/ui/icons'
import { PROJECT_NAV, SETTINGS_NAV, projectHref } from './nav'
import type { ShellProject } from './types'

interface Command {
  id: string
  group: 'Actions' | 'Go to' | 'Status pages' | 'Settings'
  label: string
  hint?: string
  icon: ComponentType<IconProps>
  keywords?: string
  run: () => void
}

function score(command: Command, query: string): number {
  if (!query) return 1
  const haystack = `${command.label} ${command.keywords ?? ''} ${command.group}`.toLowerCase()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  let total = 0
  for (const term of terms) {
    const index = haystack.indexOf(term)
    if (index === -1) return 0
    total += index === 0 ? 3 : haystack[index - 1] === ' ' ? 2 : 1
  }
  return total
}

/** ⌘K / Ctrl K palette: actions, navigation and status page switching (spec P1-16). */
export function CommandPalette({ open, onClose, projects, lastProjectId }: { open: boolean; onClose: () => void; projects: ShellProject[]; lastProjectId: string | null }) {
  const router = useRouter()
  const params = useParams<{ projectId?: string }>()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const current = projects.find((project) => project.id === params.projectId) ?? projects.find((project) => project.id === lastProjectId) ?? projects[0]

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setQuery('')
      setActive(0)
      dialog.showModal()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      onClose()
      router.push(href)
    }
    const list: Command[] = []
    if (current) {
      list.push(
        { id: 'declare', group: 'Actions', label: 'Declare incident', icon: IncidentIcon, keywords: 'new incident outage', run: go(`${projectHref(current.id, 'incidents')}?new=1`) },
        { id: 'maintenance', group: 'Actions', label: 'Schedule maintenance', icon: CalendarIcon, keywords: 'new window', run: go(`${projectHref(current.id, 'maintenance')}?new=1`) },
        { id: 'monitor', group: 'Actions', label: 'Create monitor', icon: MonitorIcon, keywords: 'new check http tcp dns tls heartbeat', run: go(`${projectHref(current.id, 'monitors')}?new=1`) },
        { id: 'component', group: 'Actions', label: 'Add component', icon: LayersIcon, keywords: 'new service', run: go(`${projectHref(current.id, 'components')}?new=1`) },
      )
      for (const item of PROJECT_NAV) {
        list.push({ id: `nav-${item.segment}`, group: 'Go to', label: item.label, hint: current.name, icon: item.icon, run: go(projectHref(current.id, item.segment)) })
      }
      list.push({
        id: 'public',
        group: 'Go to',
        label: 'Open public status page',
        hint: current.name,
        icon: StatusPageIcon,
        run: () => {
          onClose()
          window.open(current.status_page_url, '_blank', 'noopener')
        },
      })
    }
    list.push(
      { id: 'invite', group: 'Actions', label: 'Invite a teammate', icon: UsersIcon, keywords: 'member user', run: go('/settings/members?invite=1') },
      { id: 'api-key', group: 'Actions', label: 'Create API key', icon: KeyIcon, keywords: 'token terraform cli', run: go('/settings/api-keys?new=1') },
      { id: 'new-project', group: 'Actions', label: 'New status page', icon: PlusIcon, keywords: 'project', run: go('/projects?new=1') },
    )
    for (const project of projects) {
      list.push({ id: `project-${project.id}`, group: 'Status pages', label: project.name, hint: project.slug, icon: StatusPageIcon, keywords: 'switch project', run: go(projectHref(project.id)) })
    }
    for (const item of SETTINGS_NAV) {
      list.push({ id: `settings-${item.href}`, group: 'Settings', label: item.label, icon: ArrowRightIcon, keywords: 'settings', run: go(item.href) })
    }
    return list
  }, [current, projects, router, onClose])

  const results = useMemo(() => {
    return commands
      .map((command) => ({ command, score: score(command, query.trim()) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((item) => item.command)
  }, [commands, query])

  const grouped = useMemo(() => {
    const order: Command['group'][] = ['Actions', 'Go to', 'Status pages', 'Settings']
    return order.map((group) => ({ group, items: results.filter((command) => command.group === group) })).filter((entry) => entry.items.length > 0)
  }, [results])
  const flat = grouped.flatMap((entry) => entry.items)

  return (
    <dialog
      ref={dialogRef}
      className="dialog cmdk-dialog"
      aria-label="Command palette"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      {open ? (
        <>
          <input
            className="cmdk-input"
            placeholder="Type a command or search…"
            autoFocus
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={flat[active] ? `cmdk-${flat[active].id}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((value) => Math.min(flat.length - 1, value + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((value) => Math.max(0, value - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                flat[active]?.run()
              }
            }}
          />
          <div className="cmdk-list" id="cmdk-list" role="listbox">
            {flat.length === 0 ? <div className="cmdk-empty">No commands match “{query}”.</div> : null}
            {grouped.map((entry) => (
              <div key={entry.group} role="group" aria-label={entry.group}>
                <div className="cmdk-group">{entry.group}</div>
                {entry.items.map((command) => {
                  const index = flat.indexOf(command)
                  const Icon = command.icon
                  return (
                    <button
                      key={command.id}
                      id={`cmdk-${command.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      className="cmdk-item"
                      onMouseEnter={() => setActive(index)}
                      onClick={command.run}
                    >
                      <Icon size={15} />
                      {command.label}
                      {command.hint ? <span className="hint">{command.hint}</span> : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </dialog>
  )
}
