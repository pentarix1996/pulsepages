import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { setComponentManualStatus } from '@/lib/domain/components'
import { manualStatusInput } from '@/lib/domain/schemas/components'

export const PUT = appHandler<{ projectId: string; componentId: string }>(async ({ ctx, params, request }) => {
  const { status } = await readJson(request, manualStatusInput)
  return { data: await setComponentManualStatus(ctx, params.projectId, params.componentId, status) }
})
