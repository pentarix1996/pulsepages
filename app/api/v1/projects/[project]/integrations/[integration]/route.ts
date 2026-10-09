import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteIntegration, getIntegration, updateIntegration } from '@/lib/domain/integrations'
import { integrationUpdateInput } from '@/lib/domain/schemas/integrations'

type P = { project: string; integration: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => ({ data: await getIntegration(ctx, params.project, params.integration) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, integrationUpdateInput)
  return { data: await updateIntegration(ctx, params.project, params.integration, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteIntegration(ctx, params.project, params.integration)
})
