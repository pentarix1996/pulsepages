import { appHandler } from '@/lib/http/app'
import { readJson, readQuery } from '@/lib/http/responses'
import { decodeCursor, DEFAULT_PAGE_SIZE } from '@/lib/domain/pagination'
import { subscriberCreateInput, subscriberListQuery } from '@/lib/domain/schemas/subscribers'
import { addSubscriber, listSubscribers } from '@/lib/domain/subscribers'

type P = { projectId: string }

export const GET = appHandler<P>(async ({ ctx, params, request }) => {
  const query = readQuery(new URL(request.url), subscriberListQuery)
  const page = await listSubscribers(ctx, params.projectId, { limit: query.limit ?? DEFAULT_PAGE_SIZE, cursor: decodeCursor(query.cursor) }, query)
  return { data: { items: page.items, next_cursor: page.nextCursor } }
})

export const POST = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, subscriberCreateInput)
  const result = await addSubscriber(ctx, params.projectId, input)
  return { data: result, status: result.outcome === 'already_confirmed' ? 200 : 201 }
})
