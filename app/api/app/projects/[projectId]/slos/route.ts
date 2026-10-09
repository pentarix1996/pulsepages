import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createSlo, listSlos } from '@/lib/domain/slos'
import { sloCreateInput } from '@/lib/domain/schemas/metrics'

type P = { projectId: string }

export const GET = appHandler<P>(async ({ ctx, params }) => ({ data: await listSlos(ctx, params.projectId) }))

export const POST = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, sloCreateInput)
  return { data: await createSlo(ctx, params.projectId, input), status: 201 }
})
