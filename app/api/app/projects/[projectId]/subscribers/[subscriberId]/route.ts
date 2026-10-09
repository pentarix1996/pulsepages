import { appHandler } from '@/lib/http/app'
import { removeSubscriber } from '@/lib/domain/subscribers'

export const DELETE = appHandler<{ projectId: string; subscriberId: string }>(async ({ ctx, params }) => {
  await removeSubscriber(ctx, params.projectId, params.subscriberId)
})
