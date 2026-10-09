import { appHandler } from '@/lib/http/app'
import { runMonitorNow } from '@/lib/domain/monitors'

export const POST = appHandler<{ projectId: string; monitorId: string }>(async ({ ctx, params }) => ({
  data: await runMonitorNow(ctx, params.projectId, params.monitorId),
}))
