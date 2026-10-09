import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson, readQuery } from '@/lib/http/responses'
import { createMonitor, listMonitors } from '@/lib/domain/monitors'
import { pageRequest } from '@/lib/domain/pagination'
import { monitorCreateInput, monitorListQuery } from '@/lib/domain/schemas/monitors'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params, url }) => {
  const query = readQuery(url, monitorListQuery)
  const { page } = await listMonitors(ctx, params.project, { state: query.state, type: query.type, search: query.search }, pageRequest(url.searchParams))
  return { data: page.items, nextCursor: page.nextCursor }
})

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, monitorCreateInput)
  return { data: await createMonitor(ctx, params.project, input), status: 201 }
})
