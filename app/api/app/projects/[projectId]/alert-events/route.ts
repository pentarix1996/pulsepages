import { appHandler } from '@/lib/http/app'
import { readQuery } from '@/lib/http/responses'
import { listAlertEvents } from '@/lib/domain/alerts'
import { decodeCursor, DEFAULT_PAGE_SIZE } from '@/lib/domain/pagination'
import { alertEventsQuery } from '@/lib/domain/schemas/alerts'

export const GET = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => {
  const query = readQuery(new URL(request.url), alertEventsQuery)
  const page = await listAlertEvents(ctx, params.projectId, { limit: query.limit ?? DEFAULT_PAGE_SIZE, cursor: decodeCursor(query.cursor) }, { type: query.type, status: query.status })
  return { data: { items: page.items, next_cursor: page.nextCursor } }
})
