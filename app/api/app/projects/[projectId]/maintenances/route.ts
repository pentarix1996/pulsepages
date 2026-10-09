import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createMaintenance } from '@/lib/domain/maintenances'
import { maintenanceCreateInput } from '@/lib/domain/schemas/maintenances'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, maintenanceCreateInput)
  return { data: await createMaintenance(ctx, params.projectId, input), status: 201 }
})
