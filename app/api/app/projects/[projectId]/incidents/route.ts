import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createIncident } from '@/lib/domain/incidents'
import { incidentCreateInput } from '@/lib/domain/schemas/incidents'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentCreateInput)
  return { data: await createIncident(ctx, params.projectId, input), status: 201 }
})
