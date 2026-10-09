import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteMonitor, getMonitor, updateMonitor } from '@/lib/domain/monitors'
import { monitorUpdateInput } from '@/lib/domain/schemas/monitors'

type P = { project: string; monitor: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getMonitor(ctx, params.project, params.monitor) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, monitorUpdateInput)
  return { data: await updateMonitor(ctx, params.project, params.monitor, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteMonitor(ctx, params.project, params.monitor)
})
