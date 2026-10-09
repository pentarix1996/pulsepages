import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { cancelMaintenance } from '@/lib/domain/maintenances'
import { maintenanceActionInput } from '@/lib/domain/schemas/maintenances'

export const POST = appHandler<{ projectId: string; maintenanceId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, maintenanceActionInput)
  return { data: await cancelMaintenance(ctx, params.projectId, params.maintenanceId, input) }
})
