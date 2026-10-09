import type { Metadata } from 'next'
import { isPlan, PLAN_INFO } from '@shared/plans.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { StatusPageSettings } from '@/components/panel/status-page/StatusPageSettings'
import { LinkTabs } from '@/components/ui/Tabs'
import { listAccessTokens } from '@/lib/domain/access-tokens'
import { getCustomDomain } from '@/lib/domain/custom-domains'
import { getStatusPageSettings } from '@/lib/domain/status-page-settings'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/settings.css'

export const metadata: Metadata = { title: 'Status page' }

export default async function StatusPageSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const ctx = await panelContext()
  const settings = await guard(() => getStatusPageSettings(ctx, projectId))
  const id = settings.project.id
  const [domain, tokens] = await Promise.all([guard(() => getCustomDomain(ctx, id)), settings.canEdit ? guard(() => listAccessTokens(ctx, id)) : Promise.resolve([])])

  return (
    <div className="main-narrow stack" style={{ ['--gap' as string]: '22px' }}>
      <PageHeader title="Status page" subtitle="How your public page looks, who can see it and where it lives." />
      <LinkTabs
        label="Status page"
        tabs={[
          { href: `/p/${id}/status-page`, label: 'Settings', exact: true },
          { href: `/p/${id}/status-page/subscribers`, label: 'Subscribers' },
        ]}
      />
      <StatusPageSettings
        key={settings.project.updated_at}
        project={settings.project}
        domain={domain}
        tokens={tokens}
        pathPrefix={settings.pathPrefix}
        canEdit={settings.canEdit}
        gates={settings.gates}
        planName={isPlan(settings.plan) ? PLAN_INFO[settings.plan].name : settings.plan}
      />
    </div>
  )
}
