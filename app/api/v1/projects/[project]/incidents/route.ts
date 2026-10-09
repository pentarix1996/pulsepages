import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson, readQuery } from '@/lib/http/responses'
import { createIncident, listIncidents } from '@/lib/domain/incidents'
import { decodeCursor, DEFAULT_PAGE_SIZE } from '@/lib/domain/pagination'
import { incidentCreateInput, incidentListQuery } from '@/lib/domain/schemas/incidents'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params, url }) => {
  const query = readQuery(url, incidentListQuery)
  const { page } = await listIncidents(ctx, params.project, query.status, { limit: query.limit ?? DEFAULT_PAGE_SIZE, cursor: decodeCursor(query.cursor) })
  return { data: page.items, nextCursor: page.nextCursor }
})

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentCreateInput)
  return { data: await createIncident(ctx, params.project, input), status: 201 }
})
