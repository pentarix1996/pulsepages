import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { createComponentGroup, listComponentGroups } from '@/lib/domain/components'
import { groupCreateInput } from '@/lib/domain/schemas/components'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await listComponentGroups(ctx, params.project), nextCursor: null }))

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, groupCreateInput)
  return { data: await createComponentGroup(ctx, params.project, input), status: 201 }
})
