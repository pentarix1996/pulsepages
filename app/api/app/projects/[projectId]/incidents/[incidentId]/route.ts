import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteIncident, updateIncident } from '@/lib/domain/incidents'
import { incidentPatchInput } from '@/lib/domain/schemas/incidents'

type P = { projectId: string; incidentId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentPatchInput)
  return { data: await updateIncident(ctx, params.projectId, params.incidentId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteIncident(ctx, params.projectId, params.incidentId)
})
