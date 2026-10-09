import { appHandler } from '@/lib/http/app'
import { unpublishPostmortem } from '@/lib/domain/postmortems'

export const POST = appHandler<{ projectId: string; incidentId: string }>(async ({ ctx, params }) => ({
  data: await unpublishPostmortem(ctx, params.projectId, params.incidentId),
}))
