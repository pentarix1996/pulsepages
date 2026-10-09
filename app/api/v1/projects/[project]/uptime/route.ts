import { apiHandler, apiOptions } from '@/lib/http/api'
import { readQuery } from '@/lib/http/responses'
import { getProjectUptime } from '@/lib/domain/metrics'
import { uptimeQuery } from '@/lib/domain/schemas/metrics'

type P = { project: string }

export const OPTIONS = apiOptions

/** ?days=1..365 (default 90): uptime and one row per day for every component. */
export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params, url }) => {
  const { days } = readQuery(url, uptimeQuery)
  return { data: await getProjectUptime(ctx, params.project, days), nextCursor: null }
})
