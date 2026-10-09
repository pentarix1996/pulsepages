import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createIncidentTemplate } from '@/lib/domain/incident-templates'
import { incidentTemplateCreateInput } from '@/lib/domain/schemas/incidents'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentTemplateCreateInput)
  return { data: await createIncidentTemplate(ctx, params.projectId, input), status: 201 }
})
