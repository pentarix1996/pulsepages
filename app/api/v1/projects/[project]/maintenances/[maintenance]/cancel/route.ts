import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { cancelMaintenance } from '@/lib/domain/maintenances'
import { maintenanceActionInput } from '@/lib/domain/schemas/maintenances'

type P = { project: string; maintenance: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, maintenanceActionInput)
  return { data: await cancelMaintenance(ctx, params.project, params.maintenance, input) }
})
