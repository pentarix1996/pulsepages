import { apiHandler, apiOptions } from '@/lib/http/api'
import { publishPostmortem } from '@/lib/domain/postmortems'

type P = { project: string; incident: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params }) => ({
  data: await publishPostmortem(ctx, params.project, params.incident),
}))
