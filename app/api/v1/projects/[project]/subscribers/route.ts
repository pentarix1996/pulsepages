import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson, readQuery } from '@/lib/http/responses'
import { decodeCursor, DEFAULT_PAGE_SIZE } from '@/lib/domain/pagination'
import { subscriberCreateInput, subscriberListQuery } from '@/lib/domain/schemas/subscribers'
import { addSubscriber, listSubscribers } from '@/lib/domain/subscribers'

type P = { project: string }

export const OPTIONS = apiOptions

/** Subscriber lists hold personal data: write-scoped keys only (same as admins in the dashboard). */
export const GET = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, url }) => {
  const query = readQuery(url, subscriberListQuery)
  const page = await listSubscribers(ctx, params.project, { limit: query.limit ?? DEFAULT_PAGE_SIZE, cursor: decodeCursor(query.cursor) }, query)
  return { data: page.items, nextCursor: page.nextCursor }
})

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, subscriberCreateInput)
  const result = await addSubscriber(ctx, params.project, input)
  return { data: result.subscriber, status: result.outcome === 'already_confirmed' ? 200 : 201 }
})
