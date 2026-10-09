import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createComponentGroup } from '@/lib/domain/components'
import { groupCreateInput } from '@/lib/domain/schemas/components'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, groupCreateInput)
  return { data: await createComponentGroup(ctx, params.projectId, input), status: 201 }
})
