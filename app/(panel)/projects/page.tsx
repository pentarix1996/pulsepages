import type { Metadata } from 'next'
import { PageHeader } from '@/components/panel/PageHeader'
import { ProjectsManager } from '@/components/panel/projects/ProjectsManager'
import { listProjectsForPanel } from '@/lib/domain/projects'
import { panelContext } from '@/lib/panel/server'
import '@/styles/panel/settings.css'

export const metadata: Metadata = { title: 'Status pages' }

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string; joined?: string }> }) {
  const { new: openNew, joined } = await searchParams
  const ctx = await panelContext()
  const organizations = await listProjectsForPanel(ctx)
  return (
    <div className="stack" style={{ ['--gap' as string]: '26px' }}>
      <PageHeader title="Status pages" subtitle="Every status page you can manage, by organization." />
      <ProjectsManager organizations={organizations} openNew={openNew === '1'} joined={joined ?? null} />
    </div>
  )
}
