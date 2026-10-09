import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { postIncidentUpdate } from '@/lib/domain/incidents'
import { incidentUpdateInput } from '@/lib/domain/schemas/incidents'

export const POST = appHandler<{ projectId: string; incidentId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentUpdateInput)
  return { data: await postIncidentUpdate(ctx, params.projectId, params.incidentId, input), status: 201 }
})
