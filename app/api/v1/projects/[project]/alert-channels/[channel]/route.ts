import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteAlertChannel, getAlertChannel, updateAlertChannel } from '@/lib/domain/alerts'
import { alertChannelUpdateInput } from '@/lib/domain/schemas/alerts'

type P = { project: string; channel: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getAlertChannel(ctx, params.project, params.channel) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, alertChannelUpdateInput)
  return { data: await updateAlertChannel(ctx, params.project, params.channel, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteAlertChannel(ctx, params.project, params.channel)
})
