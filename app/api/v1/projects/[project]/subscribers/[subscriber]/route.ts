import { apiHandler, apiOptions } from '@/lib/http/api'
import { removeSubscriber } from '@/lib/domain/subscribers'

type P = { project: string; subscriber: string }

export const OPTIONS = apiOptions

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await removeSubscriber(ctx, params.project, params.subscriber)
})
