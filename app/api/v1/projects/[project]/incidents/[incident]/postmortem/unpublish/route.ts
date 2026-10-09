import { apiHandler, apiOptions } from '@/lib/http/api'
import { unpublishPostmortem } from '@/lib/domain/postmortems'

type P = { project: string; incident: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params }) => ({
  data: await unpublishPostmortem(ctx, params.project, params.incident),
}))
