import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteAlertChannel, updateAlertChannel } from '@/lib/domain/alerts'
import { alertChannelUpdateInput } from '@/lib/domain/schemas/alerts'

type P = { projectId: string; channelId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, alertChannelUpdateInput)
  return { data: await updateAlertChannel(ctx, params.projectId, params.channelId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteAlertChannel(ctx, params.projectId, params.channelId)
})
