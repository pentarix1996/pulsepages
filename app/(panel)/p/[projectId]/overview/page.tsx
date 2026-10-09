import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { OverviewManager } from '@/components/panel/overview/OverviewManager'
import { getOverview } from '@/lib/domain/overview'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/overview.css'

export const metadata: Metadata = { title: 'Overview' }

export default async function OverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const ctx = await panelContext()
  const jar = await cookies()
  const checklistHidden = jar.get(`upvane_hide_checklist_${projectId.slice(0, 8)}`)?.value === '1'
  const data = await guard(() => getOverview(ctx, projectId, { checklistHidden }))
  return <OverviewManager data={data} />
}
