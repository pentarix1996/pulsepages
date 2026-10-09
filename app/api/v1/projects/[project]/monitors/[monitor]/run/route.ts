import { apiHandler, apiOptions } from '@/lib/http/api'
import { runMonitorNow } from '@/lib/domain/monitors'

/** A run waits for every region (probe timeout plus up to 20 s of slack). */
export const maxDuration = 60

type P = { project: string; monitor: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params }) => ({ data: await runMonitorNow(ctx, params.project, params.monitor) }))
