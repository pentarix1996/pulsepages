import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { postMaintenanceUpdate } from '@/lib/domain/maintenances'
import { maintenanceUpdateInput } from '@/lib/domain/schemas/maintenances'

type P = { project: string; maintenance: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, maintenanceUpdateInput)
  return { data: await postMaintenanceUpdate(ctx, params.project, params.maintenance, input), status: 201 }
})
