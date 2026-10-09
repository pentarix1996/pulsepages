import { apiHandler, apiOptions } from '@/lib/http/api'
import { readQuery } from '@/lib/http/responses'
import { listMonitorResults } from '@/lib/domain/monitors'
import { pageRequest } from '@/lib/domain/pagination'
import { monitorResultsQuery } from '@/lib/domain/schemas/monitors'

type P = { project: string; monitor: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params, url }) => {
  const query = readQuery(url, monitorResultsQuery)
  const page = await listMonitorResults(ctx, params.project, params.monitor, { region: query.region, status: query.status }, pageRequest(url.searchParams))
  return { data: page.items, nextCursor: page.nextCursor }
})
