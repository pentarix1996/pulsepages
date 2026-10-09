import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteIncidentTemplate, getIncidentTemplate, updateIncidentTemplate } from '@/lib/domain/incident-templates'
import { incidentTemplateUpdateInput } from '@/lib/domain/schemas/incidents'

type P = { project: string; template: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getIncidentTemplate(ctx, params.project, params.template) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentTemplateUpdateInput)
  return { data: await updateIncidentTemplate(ctx, params.project, params.template, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteIncidentTemplate(ctx, params.project, params.template)
})
