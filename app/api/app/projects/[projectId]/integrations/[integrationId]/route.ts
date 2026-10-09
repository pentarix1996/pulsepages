import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteIntegration, updateIntegration } from '@/lib/domain/integrations'
import { integrationUpdateInput } from '@/lib/domain/schemas/integrations'

type P = { projectId: string; integrationId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, integrationUpdateInput)
  return { data: await updateIntegration(ctx, params.projectId, params.integrationId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteIntegration(ctx, params.projectId, params.integrationId)
})
