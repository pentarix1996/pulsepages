import { appHandler } from '@/lib/http/app'
import { testAlertChannel } from '@/lib/domain/alerts'

export const POST = appHandler<{ projectId: string; channelId: string }>(async ({ ctx, params }) => ({ data: await testAlertChannel(ctx, params.projectId, params.channelId) }))
