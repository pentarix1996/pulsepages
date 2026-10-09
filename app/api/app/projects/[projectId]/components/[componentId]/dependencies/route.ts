import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { setComponentDependencies } from '@/lib/domain/components'
import { dependenciesInput } from '@/lib/domain/schemas/components'

export const PUT = appHandler<{ projectId: string; componentId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, dependenciesInput)
  return { data: await setComponentDependencies(ctx, params.projectId, params.componentId, input) }
})
