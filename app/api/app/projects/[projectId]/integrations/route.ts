import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createIntegration } from '@/lib/domain/integrations'
import { integrationCreateInput } from '@/lib/domain/schemas/integrations'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, integrationCreateInput)
  return { data: await createIntegration(ctx, params.projectId, input), status: 201 }
})
