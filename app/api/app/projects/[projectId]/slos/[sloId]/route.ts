import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteSlo, updateSlo } from '@/lib/domain/slos'
import { sloUpdateInput } from '@/lib/domain/schemas/metrics'

type P = { projectId: string; sloId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, sloUpdateInput)
  return { data: await updateSlo(ctx, params.projectId, params.sloId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteSlo(ctx, params.projectId, params.sloId)
})
