import { appHandler } from '@/lib/http/app'
import { acknowledgeIncident } from '@/lib/domain/incidents'

export const POST = appHandler<{ projectId: string; incidentId: string }>(async ({ ctx, params }) => ({
  data: await acknowledgeIncident(ctx, params.projectId, params.incidentId),
}))
