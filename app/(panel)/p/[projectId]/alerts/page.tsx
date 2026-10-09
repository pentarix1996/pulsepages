import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { planAllows } from '@shared/plans.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { AlertsManager } from '@/components/panel/alerts/AlertsManager'
import { LinkTabs } from '@/components/ui/Tabs'
import { getAlertSettings, listAlertChannels, listAlertRules } from '@/lib/domain/alerts'
import { guard, panelContext, projectAccess } from '@/lib/panel/server'
import '@/styles/panel/alerts.css'

export const metadata: Metadata = { title: 'Alerts and routing' }

export default async function AlertsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const access = await projectAccess(projectId)
  const ctx = await panelContext()
  const id = access.project.id
  const [settings, channels, rules, components, monitors] = await Promise.all([
    guard(() => getAlertSettings(ctx, id)),
    guard(() => listAlertChannels(ctx, id)),
    guard(() => listAlertRules(ctx, id)),
    ctx.db.from('components').select('id, name').eq('project_id', id).order('position').order('name'),
    ctx.db.from('monitors').select('id, name').eq('project_id', id).order('name'),
  ])

  return (
    <>
      <PageHeader title="Alerts and routing" subtitle="Which events reach your team, through which channels, without repeats while something flaps." />
      <LinkTabs
        label="Alerts"
        tabs={[
          { href: `/p/${id}/alerts`, label: 'Routing', exact: true },
          { href: `/p/${id}/alerts/activity`, label: 'Activity' },
        ]}
      />
      <AlertsManager
        projectId={id}
        settings={settings}
        channels={channels}
        rules={rules}
        components={(components.data ?? []) as Array<{ id: string; name: string }>}
        monitors={(monitors.data ?? []) as Array<{ id: string; name: string }>}
        canEdit={hasRole(access.role, 'admin')}
        pagingAllowed={planAllows(access.organization.plan, 'paging_channels')}
      />
    </>
  )
}
