import { apiHandler, apiOptions } from '@/lib/http/api'
import { acknowledgeIncident } from '@/lib/domain/incidents'

type P = { project: string; incident: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params }) => ({
  data: await acknowledgeIncident(ctx, params.project, params.incident),
}))
