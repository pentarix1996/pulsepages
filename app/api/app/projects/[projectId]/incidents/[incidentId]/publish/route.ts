import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { publishIncident } from '@/lib/domain/incidents'
import { incidentPublishInput } from '@/lib/domain/schemas/incidents'

export const POST = appHandler<{ projectId: string; incidentId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentPublishInput)
  return { data: await publishIncident(ctx, params.projectId, params.incidentId, input) }
})
