'use client'

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { PLAN_INFO } from '@shared/plans.ts'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Avatar } from '@/components/ui/Misc'
import { ChevronUpDownIcon, ExternalLinkIcon, LogOutIcon, LogoMarkIcon, PlusIcon, SearchIcon, SettingsIcon, StatusPageIcon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { PROJECT_NAV, SETTINGS_NAV, projectHref } from './nav'
import type { ShellCounts, ShellOrganization, ShellProject, ShellUser } from './types'

export function Sidebar({ user, organizations, projects, counts, lastProjectId, onOpenPalette }: { user: ShellUser; organizations: ShellOrganization[]; projects: ShellProject[]; counts: ShellCounts; lastProjectId: string | null; onOpenPalette: () => void }) {
  const params = useParams<{ projectId?: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const current = projects.find((project) => project.id === params.projectId) ?? projects.find((project) => project.id === lastProjectId) ?? projects[0] ?? null
  const currentOrg = organizations.find((org) => org.id === current?.organization_id) ?? organizations[0] ?? null
  const inSettings = pathname.startsWith('/settings')

  const signOut = async () => {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="side" aria-label="Workspace">
      <Link className="side-logo" href={current ? projectHref(current.id) : '/projects'} aria-label="Upvane home">
        <span className="mark">
          <LogoMarkIcon size={16} strokeWidth={2.3} />
        </span>
        Upvane
      </Link>

      <Menu
        className="switcher"
        label="Switch status page"
        align="left"
        trigger={(props) => (
          <button type="button" className="switcher-btn" {...props} aria-label="Switch status page">
            <span className="truncate">
              {current ? current.name : 'No status page yet'}
              <small className="truncate">{currentOrg ? currentOrg.name : 'Workspace'}</small>
            </span>
            <ChevronUpDownIcon size={14} />
          </button>
        )}
      >
        {(close) => (
          <>
            {organizations.map((org) => {
              const orgProjects = projects.filter((project) => project.organization_id === org.id)
              return (
                <div key={org.id}>
                  <div className="menu-label">{org.name}</div>
                  {orgProjects.map((project) => (
                    <MenuItem
                      key={project.id}
                      icon={<StatusPageIcon size={14} />}
                      onSelect={() => {
                        close()
                        const section = pathname.match(/^\/p\/[^/]+\/([^/]+)/)?.[1] ?? 'overview'
                        router.push(projectHref(project.id, section))
                      }}
                    >
                      <span className="truncate">{project.name}</span>
                    </MenuItem>
                  ))}
                  {orgProjects.length === 0 ? <div className="menu-label">No status pages</div> : null}
                </div>
              )
            })}
            <div className="menu-sep" />
            <MenuItem icon={<PlusIcon size={14} />} onSelect={() => { close(); router.push('/projects?new=1') }}>
              New status page
            </MenuItem>
            <MenuItem icon={<SettingsIcon size={14} />} onSelect={() => { close(); router.push('/projects') }}>
              All status pages
            </MenuItem>
          </>
        )}
      </Menu>

      <button type="button" className="cmdk-trigger" onClick={onOpenPalette}>
        <SearchIcon size={15} />
        Search or run a command
        <kbd className="kbd">⌘K</kbd>
      </button>

      {current ? (
        <nav className="nav" aria-label="Status page sections">
          {PROJECT_NAV.map((item) => {
            const href = projectHref(current.id, item.segment)
            const active = !inSettings && (pathname === href || pathname.startsWith(`${href}/`))
            const count = item.count === 'incidents' ? counts.incidents[current.id] : item.count === 'monitors' ? counts.monitors[current.id] : undefined
            const Icon = item.icon
            return (
              <Link key={item.segment} href={href} aria-current={active ? 'page' : undefined}>
                <Icon size={16} />
                {item.label}
                {count ? (
                  <span className="count" aria-label={`${count} ${item.count === 'incidents' ? 'active incidents' : 'failing monitors'}`}>
                    {count}
                  </span>
                ) : null}
              </Link>
            )
          })}
          <a href={current.status_page_url} target="_blank" rel="noreferrer">
            <ExternalLinkIcon size={16} />
            View public page
          </a>
        </nav>
      ) : null}

      <nav className="nav" aria-label="Settings">
        <div className="nav-label">Settings</div>
        {SETTINGS_NAV.slice(0, 5).map((item) => (
          <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="side-foot">
        <Avatar name={user.name} />
        <span className="who grow">
          <strong className="truncate">{user.name}</strong>
          <span className="truncate">{currentOrg ? `${PLAN_INFO[currentOrg.plan].name} plan` : user.email}</span>
        </span>
        <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label="Sign out" title="Sign out" onClick={signOut}>
          <LogOutIcon size={15} />
        </button>
      </div>
    </aside>
  )
}
