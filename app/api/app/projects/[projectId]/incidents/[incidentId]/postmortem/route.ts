import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createPostmortem, savePostmortem } from '@/lib/domain/postmortems'
import { postmortemInput } from '@/lib/domain/schemas/postmortems'

type P = { projectId: string; incidentId: string }

/** Creates the draft (prefilled with the incident timeline), or returns the existing postmortem. */
export const POST = appHandler<P>(async ({ ctx, params }) => ({ data: await createPostmortem(ctx, params.projectId, params.incidentId), status: 201 }))

export const PUT = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, postmortemInput)
  return { data: await savePostmortem(ctx, params.projectId, params.incidentId, input) }
})
