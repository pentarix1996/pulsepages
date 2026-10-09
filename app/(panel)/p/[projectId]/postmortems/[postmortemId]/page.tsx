import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { PostmortemEditor } from '@/components/panel/postmortems/PostmortemEditor'
import { getPostmortemView } from '@/lib/domain/postmortems'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/incidents.css'

export const metadata: Metadata = { title: 'Postmortem' }

export default async function PostmortemPage({ params }: { params: Promise<{ projectId: string; postmortemId: string }> }) {
  const { projectId, postmortemId } = await params
  const ctx = await panelContext()
  const view = await guard(() => getPostmortemView(ctx, projectId, postmortemId))

  return (
    <PostmortemEditor
      key={`${view.postmortem.id}:${view.postmortem.updated_at}`}
      projectId={view.access.project.id}
      timeZone={view.access.project.timezone || 'UTC'}
      postmortem={view.postmortem}
      incident={view.incident}
      canEdit={hasRole(view.access.role, 'responder')}
    />
  )
}
