import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteComponent, updateComponent } from '@/lib/domain/components'
import { componentUpdateInput } from '@/lib/domain/schemas/components'

type P = { projectId: string; componentId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, componentUpdateInput)
  return { data: await updateComponent(ctx, params.projectId, params.componentId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteComponent(ctx, params.projectId, params.componentId)
})
