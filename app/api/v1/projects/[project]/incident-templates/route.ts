import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { createIncidentTemplate, listIncidentTemplates } from '@/lib/domain/incident-templates'
import { incidentTemplateCreateInput } from '@/lib/domain/schemas/incidents'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await listIncidentTemplates(ctx, params.project), nextCursor: null }))

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentTemplateCreateInput)
  return { data: await createIncidentTemplate(ctx, params.project, input), status: 201 }
})
