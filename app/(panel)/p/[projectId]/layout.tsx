import type { ReactNode } from 'react'
import { RealtimeRefresh, RememberProject } from '@/components/panel/RealtimeRefresh'
import { projectAccess } from '@/lib/panel/server'

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const access = await projectAccess(projectId)
  return (
    <>
      <RealtimeRefresh projectId={access.project.id} />
      <RememberProject projectId={access.project.id} />
      {children}
    </>
  )
}
