import { appHandler } from '@/lib/http/app'
import { publishPostmortem } from '@/lib/domain/postmortems'

export const POST = appHandler<{ projectId: string; incidentId: string }>(async ({ ctx, params }) => ({
  data: await publishPostmortem(ctx, params.projectId, params.incidentId),
}))
