import { apiHandler, apiOptions } from '@/lib/http/api'
import { readQuery } from '@/lib/http/responses'
import { listAlertEvents } from '@/lib/domain/alerts'
import { decodeCursor, DEFAULT_PAGE_SIZE } from '@/lib/domain/pagination'
import { alertEventsQuery } from '@/lib/domain/schemas/alerts'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params, url }) => {
  const query = readQuery(url, alertEventsQuery)
  const page = await listAlertEvents(ctx, params.project, { limit: query.limit ?? DEFAULT_PAGE_SIZE, cursor: decodeCursor(query.cursor) }, { type: query.type, status: query.status })
  return { data: page.items, nextCursor: page.nextCursor }
})
