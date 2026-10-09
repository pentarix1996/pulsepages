import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { IncidentCommand } from '@/components/panel/incidents/IncidentCommand'
import { getIncidentView } from '@/lib/domain/incidents'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/incidents.css'

export const metadata: Metadata = { title: 'Incident' }

export default async function IncidentPage({ params }: { params: Promise<{ projectId: string; incidentId: string }> }) {
  const { projectId, incidentId } = await params
  const ctx = await panelContext()
  const view = await guard(() => getIncidentView(ctx, projectId, incidentId))

  return (
    <IncidentCommand
      key={view.incident.id}
      projectId={view.access.project.id}
      timeZone={view.access.project.timezone || 'UTC'}
      incident={view.incident}
      components={view.components.map((component) => ({ id: component.id, name: component.name, slug: component.slug }))}
      openedBy={view.openedBy}
      sourceMonitor={view.sourceMonitor}
      canRespond={hasRole(view.access.role, 'responder')}
      canDelete={hasRole(view.access.role, 'admin')}
    />
  )
}
