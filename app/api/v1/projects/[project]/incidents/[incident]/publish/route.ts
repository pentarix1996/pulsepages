import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { publishIncident } from '@/lib/domain/incidents'
import { incidentPublishInput } from '@/lib/domain/schemas/incidents'

type P = { project: string; incident: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, incidentPublishInput)
  return { data: await publishIncident(ctx, params.project, params.incident, input) }
})
