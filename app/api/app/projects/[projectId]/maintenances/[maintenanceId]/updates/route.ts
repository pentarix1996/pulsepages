import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { postMaintenanceUpdate } from '@/lib/domain/maintenances'
import { maintenanceUpdateInput } from '@/lib/domain/schemas/maintenances'

export const POST = appHandler<{ projectId: string; maintenanceId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, maintenanceUpdateInput)
  return { data: await postMaintenanceUpdate(ctx, params.projectId, params.maintenanceId, input), status: 201 }
})
