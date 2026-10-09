import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createComponent } from '@/lib/domain/components'
import { componentCreateInput } from '@/lib/domain/schemas/components'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, componentCreateInput)
  return { data: await createComponent(ctx, params.projectId, input), status: 201 }
})
