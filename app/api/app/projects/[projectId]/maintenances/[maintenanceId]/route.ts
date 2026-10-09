import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { cancelMaintenance, updateMaintenance } from '@/lib/domain/maintenances'
import { maintenancePatchInput } from '@/lib/domain/schemas/maintenances'

type P = { projectId: string; maintenanceId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, maintenancePatchInput)
  return { data: await updateMaintenance(ctx, params.projectId, params.maintenanceId, input) }
})

/** Cancels the window (maintenance windows stay in the history). */
export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await cancelMaintenance(ctx, params.projectId, params.maintenanceId)
})
