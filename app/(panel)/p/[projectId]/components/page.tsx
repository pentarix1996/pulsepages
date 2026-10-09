import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { ComponentsManager } from '@/components/panel/components/ComponentsManager'
import { PageHeader } from '@/components/panel/PageHeader'
import { listComponents } from '@/lib/domain/components'
import { guard, panelContext } from '@/lib/panel/server'

export const metadata: Metadata = { title: 'Components' }

export default async function ComponentsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ new?: string }> }) {
  const { projectId } = await params
  const { new: openNew } = await searchParams
  const ctx = await panelContext()
  const { access, components, groups } = await guard(() => listComponents(ctx, projectId))

  const { data: links } = await ctx.db
    .from('monitor_components')
    .select('component_id, monitor:monitors(id, name, state)')
    .in('component_id', components.length > 0 ? components.map((component) => component.id) : ['00000000-0000-0000-0000-000000000000'])
  const monitorsByComponent: Record<string, Array<{ id: string; name: string; state: string }>> = {}
  for (const link of (links ?? []) as unknown as Array<{ component_id: string; monitor: { id: string; name: string; state: string } | null }>) {
    if (!link.monitor) continue
    ;(monitorsByComponent[link.component_id] ??= []).push(link.monitor)
  }

  return (
    <>
      <PageHeader
        title="Components"
        subtitle="What your status page shows. Status comes from incidents, maintenance, pins, monitors and dependencies, in that order."
      />
      <ComponentsManager
        projectId={access.project.id}
        components={components}
        groups={groups}
        monitorsByComponent={monitorsByComponent}
        canEdit={hasRole(access.role, 'admin')}
        canPin={hasRole(access.role, 'responder')}
        openNew={openNew === '1'}
      />
    </>
  )
}
