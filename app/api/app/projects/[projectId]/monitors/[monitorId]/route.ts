import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteMonitor, updateMonitor } from '@/lib/domain/monitors'
import { monitorUpdateInput } from '@/lib/domain/schemas/monitors'

type P = { projectId: string; monitorId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, monitorUpdateInput)
  return { data: await updateMonitor(ctx, params.projectId, params.monitorId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteMonitor(ctx, params.projectId, params.monitorId)
})
