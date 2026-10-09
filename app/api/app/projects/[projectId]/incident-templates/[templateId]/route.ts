import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteIncidentTemplate, updateIncidentTemplate } from '@/lib/domain/incident-templates'
import { incidentTemplateUpdateInput } from '@/lib/domain/schemas/incidents'

type P = { projectId: string; templateId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentTemplateUpdateInput)
  return { data: await updateIncidentTemplate(ctx, params.projectId, params.templateId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteIncidentTemplate(ctx, params.projectId, params.templateId)
})
