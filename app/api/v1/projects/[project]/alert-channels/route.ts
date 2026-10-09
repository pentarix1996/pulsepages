import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { createAlertChannel, listAlertChannels } from '@/lib/domain/alerts'
import { alertChannelCreateInput } from '@/lib/domain/schemas/alerts'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await listAlertChannels(ctx, params.project), nextCursor: null }))

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, alertChannelCreateInput)
  return { data: await createAlertChannel(ctx, params.project, input), status: 201 }
})
