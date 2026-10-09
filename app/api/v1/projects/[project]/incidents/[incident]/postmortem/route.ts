import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { getPostmortem, savePostmortem } from '@/lib/domain/postmortems'
import { postmortemInput } from '@/lib/domain/schemas/postmortems'

type P = { project: string; incident: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getPostmortem(ctx, params.project, params.incident) }))

/** Creates the draft when the incident has none yet, then saves the fields sent. */
export const PUT = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, postmortemInput)
  return { data: await savePostmortem(ctx, params.project, params.incident, input) }
})
