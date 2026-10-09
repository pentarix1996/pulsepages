import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteIncident, getIncident, legacyUpdateIncident, updateIncident } from '@/lib/domain/incidents'
import { incidentLegacyUpdateInput, incidentPatchInput } from '@/lib/domain/schemas/incidents'

type P = { project: string; incident: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getIncident(ctx, params.project, params.incident) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentPatchInput)
  return { data: await updateIncident(ctx, params.project, params.incident, input) }
})

/** v0 compatibility: PUT also accepted severity, status, component_ids and a message that became an update. */
export const PUT = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentLegacyUpdateInput)
  return { data: await legacyUpdateIncident(ctx, params.project, params.incident, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteIncident(ctx, params.project, params.incident)
})
