import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { IncidentsManager } from '@/components/panel/incidents/IncidentsManager'
import { listIncidentTemplates } from '@/lib/domain/incident-templates'
import { countIncidents, listIncidents, loadComponentIndex } from '@/lib/domain/incidents'
import { decodeCursor, type Cursor } from '@/lib/domain/pagination'
import { INCIDENT_LIST_FILTERS, type IncidentListFilter } from '@/lib/domain/schemas/incidents'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/incidents.css'

export const metadata: Metadata = { title: 'Incidents' }

const PAGE_SIZE = 25

type SearchParams = { status?: string; cursor?: string; tab?: string; new?: string }

function safeCursor(value: string | undefined): Cursor | null {
  try {
    return decodeCursor(value)
  } catch {
    return null
  }
}

export default async function IncidentsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<SearchParams> }) {
  const { projectId } = await params
  const query = await searchParams
  const filter: IncidentListFilter = (INCIDENT_LIST_FILTERS as readonly string[]).includes(query.status ?? '') ? (query.status as IncidentListFilter) : 'all'
  const cursor = safeCursor(query.cursor)
  const ctx = await panelContext()

  const { access, page } = await guard(() => listIncidents(ctx, projectId, filter, { limit: PAGE_SIZE, cursor }))
  const [counts, templates, components] = await Promise.all([
    countIncidents(ctx, access.project.id),
    listIncidentTemplates(ctx, access.project.id),
    loadComponentIndex(ctx, access.project.id),
  ])

  return (
    <IncidentsManager
      projectId={access.project.id}
      tab={query.tab === 'templates' ? 'templates' : 'incidents'}
      filter={filter}
      incidents={page.items}
      nextCursor={page.nextCursor}
      isFirstPage={cursor === null}
      counts={counts}
      components={components.map((component) => ({ id: component.id, name: component.name, slug: component.slug }))}
      templates={templates}
      canRespond={hasRole(access.role, 'responder')}
      openNew={query.new === '1'}
    />
  )
}
