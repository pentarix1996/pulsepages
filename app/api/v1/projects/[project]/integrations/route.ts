import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { createIntegration, listIntegrations } from '@/lib/domain/integrations'
import { integrationCreateInput } from '@/lib/domain/schemas/integrations'

type P = { project: string }

export const OPTIONS = apiOptions

// Integration URLs contain secret tokens: reading them needs a write key (admin), like in the dashboard.
export const GET = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  const { integrations } = await listIntegrations(ctx, params.project)
  return { data: integrations, nextCursor: null }
})

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, integrationCreateInput)
  return { data: await createIntegration(ctx, params.project, input), status: 201 }
})
