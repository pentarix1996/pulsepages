import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { cancelMaintenance, getMaintenance, updateMaintenance } from '@/lib/domain/maintenances'
import { maintenancePatchInput } from '@/lib/domain/schemas/maintenances'

type P = { project: string; maintenance: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getMaintenance(ctx, params.project, params.maintenance) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, maintenancePatchInput)
  return { data: await updateMaintenance(ctx, params.project, params.maintenance, input) }
})

/** Maintenance windows are never deleted: DELETE cancels the window (it stays in the history). */
export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await cancelMaintenance(ctx, params.project, params.maintenance)
})
