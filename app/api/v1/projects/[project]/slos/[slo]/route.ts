import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteSlo, getSlo, updateSlo } from '@/lib/domain/slos'
import { sloUpdateInput } from '@/lib/domain/schemas/metrics'

type P = { project: string; slo: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getSlo(ctx, params.project, params.slo) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, sloUpdateInput)
  return { data: await updateSlo(ctx, params.project, params.slo, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteSlo(ctx, params.project, params.slo)
})
