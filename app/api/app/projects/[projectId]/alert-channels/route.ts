import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createAlertChannel, listAlertChannels } from '@/lib/domain/alerts'
import { alertChannelCreateInput } from '@/lib/domain/schemas/alerts'

type P = { projectId: string }

export const GET = appHandler<P>(async ({ ctx, params }) => ({ data: await listAlertChannels(ctx, params.projectId) }))

export const POST = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, alertChannelCreateInput)
  return { data: await createAlertChannel(ctx, params.projectId, input), status: 201 }
})
