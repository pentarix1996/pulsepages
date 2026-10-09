import type { Metadata } from 'next'
import { connection } from 'next/server'
import { hasRole } from '@shared/domain.ts'
import { MaintenanceDetail } from '@/components/panel/maintenance/MaintenanceDetail'
import { getMaintenanceView } from '@/lib/domain/maintenances'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/incidents.css'
import '@/styles/panel/maintenance.css'

export const metadata: Metadata = { title: 'Maintenance' }

export default async function MaintenanceWindowPage({ params }: { params: Promise<{ projectId: string; maintenanceId: string }> }) {
  const { projectId, maintenanceId } = await params
  const ctx = await panelContext()
  const { access, maintenance, components } = await guard(() => getMaintenanceView(ctx, projectId, maintenanceId))
  await connection()
  // Dynamic Server Component (after connection()): one clock read per request.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()

  return (
    <MaintenanceDetail
      key={maintenance.id}
      projectId={access.project.id}
      timeZone={access.project.timezone || 'UTC'}
      maintenance={maintenance}
      components={components.map((component) => ({ id: component.id, name: component.name, slug: component.slug }))}
      canRespond={hasRole(access.role, 'responder')}
      now={now}
    />
  )
}
