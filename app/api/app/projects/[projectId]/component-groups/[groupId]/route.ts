import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteComponentGroup, updateComponentGroup } from '@/lib/domain/components'
import { groupUpdateInput } from '@/lib/domain/schemas/components'

type P = { projectId: string; groupId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, groupUpdateInput)
  return { data: await updateComponentGroup(ctx, params.projectId, params.groupId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteComponentGroup(ctx, params.projectId, params.groupId)
})
