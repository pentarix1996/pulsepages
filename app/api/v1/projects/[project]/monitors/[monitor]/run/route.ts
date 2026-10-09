import { apiHandler, apiOptions } from '@/lib/http/api'
import { runMonitorNow } from '@/lib/domain/monitors'

type P = { project: string; monitor: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params }) => ({ data: await runMonitorNow(ctx, params.project, params.monitor) }))
