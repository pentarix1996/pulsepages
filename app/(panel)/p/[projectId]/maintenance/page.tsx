import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { MaintenanceManager } from '@/components/panel/maintenance/MaintenanceManager'
import { loadComponentIndex } from '@/lib/domain/incidents'
import { listMaintenances } from '@/lib/domain/maintenances'
import { decodeCursor, MAX_PAGE_SIZE, type Cursor } from '@/lib/domain/pagination'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/incidents.css'
import '@/styles/panel/maintenance.css'

export const metadata: Metadata = { title: 'Maintenance' }

function safeCursor(value: string | undefined): Cursor | null {
  try {
    return decodeCursor(value)
  } catch {
    return null
  }
}

export default async function MaintenancePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ new?: string; cursor?: string }> }) {
  const { projectId } = await params
  const query = await searchParams
  const pastCursor = safeCursor(query.cursor)
  const ctx = await panelContext()

  const { access, page: active } = await guard(() => listMaintenances(ctx, projectId, 'active', { limit: MAX_PAGE_SIZE, cursor: null }))
  const [upcoming, past, components] = await Promise.all([
    listMaintenances(ctx, access.project.id, 'upcoming', { limit: MAX_PAGE_SIZE, cursor: null }),
    listMaintenances(ctx, access.project.id, 'past', { limit: 20, cursor: pastCursor }),
    loadComponentIndex(ctx, access.project.id),
  ])

  return (
    <MaintenanceManager
      projectId={access.project.id}
      timeZone={access.project.timezone || 'UTC'}
      active={active.items}
      upcoming={upcoming.page.items}
      past={past.page.items}
      pastCursor={past.page.nextCursor}
      isFirstPastPage={pastCursor === null}
      components={components.map((component) => ({ id: component.id, name: component.name, slug: component.slug }))}
      canRespond={hasRole(access.role, 'responder')}
      openNew={query.new === '1'}
    />
  )
}
