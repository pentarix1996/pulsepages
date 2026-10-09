import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createMonitor } from '@/lib/domain/monitors'
import { monitorCreateInput } from '@/lib/domain/schemas/monitors'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const input = await readJson(request, monitorCreateInput)
  return { data: await createMonitor(ctx, params.projectId, input), status: 201 }
})
