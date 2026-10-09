import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { reorderComponents } from '@/lib/domain/components'
import { reorderInput } from '@/lib/domain/schemas/components'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  await reorderComponents(ctx, params.projectId, await readJson(request, reorderInput))
})
