import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson, readQuery } from '@/lib/http/responses'
import { createMaintenance, listMaintenances } from '@/lib/domain/maintenances'
import { decodeCursor, DEFAULT_PAGE_SIZE } from '@/lib/domain/pagination'
import { maintenanceCreateInput, maintenanceListQuery } from '@/lib/domain/schemas/maintenances'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params, url }) => {
  const query = readQuery(url, maintenanceListQuery)
  const { page } = await listMaintenances(ctx, params.project, query.status, { limit: query.limit ?? DEFAULT_PAGE_SIZE, cursor: decodeCursor(query.cursor) })
  return { data: page.items, nextCursor: page.nextCursor }
})

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, maintenanceCreateInput)
  return { data: await createMaintenance(ctx, params.project, input), status: 201 }
})
