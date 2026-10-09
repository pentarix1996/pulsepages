import { apiHandler, apiOptions } from '@/lib/http/api'
import { testAlertChannel } from '@/lib/domain/alerts'

type P = { project: string; channel: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params }) => ({ data: await testAlertChannel(ctx, params.project, params.channel) }))
