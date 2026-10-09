import { apiHandler, apiOptions } from '@/lib/http/api'
import { readQuery } from '@/lib/http/responses'
import { getProjectMetrics } from '@/lib/domain/metrics'
import { metricsQuery } from '@/lib/domain/schemas/metrics'

type P = { project: string }

export const OPTIONS = apiOptions

/** ?from=&to= (ISO 8601; default the last 30 days, at most 400 days). */
export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params, url }) => ({ data: await getProjectMetrics(ctx, params.project, readQuery(url, metricsQuery)) }))
