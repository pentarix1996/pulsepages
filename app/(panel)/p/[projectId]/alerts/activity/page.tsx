import type { Metadata } from 'next'
import { ALERT_EVENT_TYPES } from '@shared/domain.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { AlertActivity } from '@/components/panel/alerts/AlertActivity'
import { LinkTabs } from '@/components/ui/Tabs'
import { listAlertEvents } from '@/lib/domain/alerts'
import { decodeCursor, type Cursor } from '@/lib/domain/pagination'
import { ALERT_EVENT_STATUS_FILTERS, type AlertEventStatusFilter } from '@/lib/domain/schemas/alerts'
import { guard, panelContext, projectAccess } from '@/lib/panel/server'
import '@/styles/panel/alerts.css'

export const metadata: Metadata = { title: 'Alert activity' }

function safeCursor(value: string | undefined): Cursor | null {
  try {
    return decodeCursor(value)
  } catch {
    return null
  }
}

export default async function AlertActivityPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ type?: string; status?: string; cursor?: string }> }) {
  const { projectId } = await params
  const query = await searchParams
  const access = await projectAccess(projectId)
  const ctx = await panelContext()
  const id = access.project.id
  const type = (ALERT_EVENT_TYPES as readonly string[]).includes(query.type ?? '') ? query.type! : undefined
  const status = (ALERT_EVENT_STATUS_FILTERS as readonly string[]).includes(query.status ?? '') ? (query.status as AlertEventStatusFilter) : undefined
  const cursor = safeCursor(query.cursor)
  const page = await guard(() => listAlertEvents(ctx, id, { limit: 30, cursor }, { type, status }))

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
      <AlertActivity events={page.items} nextCursor={page.nextCursor} isFirstPage={cursor === null} type={type ?? null} status={status ?? 'all'} timeZone={access.project.timezone || 'UTC'} />
    </>
  )
}
