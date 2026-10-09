import type { Metadata } from 'next'
import { hasRole, SUBSCRIBER_TYPES } from '@shared/domain.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { SubscribersManager } from '@/components/panel/status-page/SubscribersManager'
import { Card, EmptyState } from '@/components/ui/Card'
import { LinkTabs } from '@/components/ui/Tabs'
import { decodeCursor, type Cursor } from '@/lib/domain/pagination'
import { countSubscribers, listSubscribers } from '@/lib/domain/subscribers'
import { guard, panelContext, projectAccess } from '@/lib/panel/server'
import '@/styles/panel/alerts.css'
import '@/styles/panel/settings.css'

export const metadata: Metadata = { title: 'Subscribers' }

function safeCursor(value: string | undefined): Cursor | null {
  try {
    return decodeCursor(value)
  } catch {
    return null
  }
}

export default async function SubscribersPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ type?: string; status?: string; q?: string; cursor?: string }> }) {
  const { projectId } = await params
  const query = await searchParams
  const access = await projectAccess(projectId)
  const id = access.project.id
  const tabs = (
    <>
      <PageHeader title="Status page" subtitle="How your public page looks, who can see it and where it lives." />
      <LinkTabs
        label="Status page"
        tabs={[
          { href: `/p/${id}/status-page`, label: 'Settings', exact: true },
          { href: `/p/${id}/status-page/subscribers`, label: 'Subscribers' },
        ]}
      />
    </>
  )
  if (!hasRole(access.role, 'admin')) {
    return (
      <div className="main-narrow stack" style={{ ['--gap' as string]: '22px' }}>
        {tabs}
        <Card>
          <EmptyState title="Admins manage subscribers" description="Subscriber lists hold your customers' contact details, so only admins and owners can see them." center />
        </Card>
      </div>
    )
  }

  const ctx = await panelContext()
  const type = (SUBSCRIBER_TYPES as readonly string[]).includes(query.type ?? '') ? (query.type as (typeof SUBSCRIBER_TYPES)[number]) : undefined
  const status = query.status === 'confirmed' || query.status === 'pending' ? query.status : undefined
  const q = (query.q ?? '').trim().slice(0, 100)
  const cursor = safeCursor(query.cursor)
  const [page, counts, components] = await Promise.all([
    guard(() => listSubscribers(ctx, id, { limit: 50, cursor }, { type, status, q: q || undefined })),
    guard(() => countSubscribers(ctx, id)),
    ctx.db.from('components').select('id, name').eq('project_id', id).order('position').order('name'),
  ])

  return (
    <div className="stack" style={{ ['--gap' as string]: '22px' }}>
      {tabs}
      <SubscribersManager
        projectId={id}
        subscribers={page.items}
        counts={counts}
        nextCursor={page.nextCursor}
        isFirstPage={cursor === null}
        filters={{ type: type ?? null, status: status ?? null, q }}
        components={(components.data ?? []) as Array<{ id: string; name: string }>}
        canEdit
      />
    </div>
  )
}
