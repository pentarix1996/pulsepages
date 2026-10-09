import type { ReactNode } from 'react'
import { PageHeader } from '@/components/panel/PageHeader'
import { SETTINGS_NAV } from '@/components/panel/nav'
import { OrgSwitcher } from '@/components/panel/settings/OrgSwitcher'
import { LinkTabs } from '@/components/ui/Tabs'
import { settingsScope } from './_lib/scope'
import '@/styles/panel/settings.css'

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const scope = await settingsScope()
  return (
    <div className="settings">
      <PageHeader
        title="Settings"
        subtitle="Your account, the organizations you belong to and how your team works in Upvane."
        actions={scope ? <OrgSwitcher current={scope.current} organizations={scope.organizations} /> : null}
      />
      <LinkTabs tabs={SETTINGS_NAV.map((item) => ({ href: item.href, label: item.label }))} label="Settings sections" />
      <div className="settings-body">{children}</div>
    </div>
  )
}
