'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { ORG_ROLE_LABELS } from '@shared/domain.ts'
import { PLAN_INFO } from '@shared/plans.ts'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { CheckIcon, ChevronUpDownIcon, PlusIcon } from '@/components/ui/icons'
import type { OrganizationResource } from '@/lib/domain/schemas/organizations'
import { rememberOrganization } from './org-cookie'

/** Tabs that belong to the person, not to an organization. */
const PERSONAL_TABS = ['/settings/account', '/settings/security']

/** Picks the organization the settings tabs act on (stored in the upv_org cookie). */
export function OrgSwitcher({ current, organizations }: { current: OrganizationResource; organizations: OrganizationResource[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  if (PERSONAL_TABS.some((tab) => pathname.startsWith(tab))) return null

  const choose = (organization: OrganizationResource) => {
    rememberOrganization(organization.id)
    startTransition(() => router.refresh())
  }

  const personal = organizations.filter((org) => org.personal)
  const teams = organizations.filter((org) => !org.personal)

  return (
    <Menu
      className="org-switcher"
      label="Switch organization"
      trigger={(props) => (
        <button type="button" className="switcher-btn" {...props} aria-label={`Organization: ${current.name}. Switch organization`} aria-busy={pending || undefined}>
          <span className="truncate">
            {current.name}
            <small className="truncate">
              {current.personal ? 'Personal workspace' : 'Organization'} · {PLAN_INFO[current.plan].name} · {ORG_ROLE_LABELS[current.role]}
            </small>
          </span>
          <ChevronUpDownIcon size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          {[
            { label: 'Personal workspace', items: personal },
            { label: 'Organizations', items: teams },
          ]
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.label}>
                <div className="menu-label">{group.label}</div>
                {group.items.map((org) => (
                  <MenuItem
                    key={org.id}
                    icon={org.id === current.id ? <CheckIcon size={14} /> : <span className="menu-icon-gap" aria-hidden="true" />}
                    onSelect={() => {
                      close()
                      if (org.id !== current.id) choose(org)
                    }}
                  >
                    <span className="grow truncate">{org.name}</span>
                    <span className="faint org-switcher-meta">{PLAN_INFO[org.plan].name}</span>
                  </MenuItem>
                ))}
              </div>
            ))}
          <div className="menu-sep" />
          <MenuItem
            icon={<PlusIcon size={14} />}
            onSelect={() => {
              close()
              router.push('/settings/organization?new=1')
            }}
          >
            Create organization
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
