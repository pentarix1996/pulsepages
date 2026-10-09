import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { createSlo, listSlos } from '@/lib/domain/slos'
import { sloCreateInput } from '@/lib/domain/schemas/metrics'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await listSlos(ctx, params.project), nextCursor: null }))

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, sloCreateInput)
  return { data: await createSlo(ctx, params.project, input), status: 201 }
})
