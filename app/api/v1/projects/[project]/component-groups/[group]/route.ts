import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteComponentGroup, updateComponentGroup } from '@/lib/domain/components'
import { groupUpdateInput } from '@/lib/domain/schemas/components'

type P = { project: string; group: string }

export const OPTIONS = apiOptions

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, groupUpdateInput)
  return { data: await updateComponentGroup(ctx, params.project, params.group, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteComponentGroup(ctx, params.project, params.group)
})
