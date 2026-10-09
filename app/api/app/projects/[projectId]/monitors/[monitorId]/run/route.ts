import { appHandler } from '@/lib/http/app'
import { runMonitorNow } from '@/lib/domain/monitors'

/** A run waits for every region (probe timeout plus up to 20 s of slack). */
export const maxDuration = 60

export const POST = appHandler<{ projectId: string; monitorId: string }>(async ({ ctx, params }) => ({
  data: await runMonitorNow(ctx, params.projectId, params.monitorId),
}))
