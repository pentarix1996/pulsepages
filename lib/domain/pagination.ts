import { invalid } from './errors'

export interface PageRequest {
  limit: number
  cursor: Cursor | null
}

export interface Cursor {
  /** Sort key of the last item returned (usually created_at or another timestamp). */
  at: string
  id: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id])).toString('base64url')
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null
  try {
    const [at, id] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as [string, string]
    if (typeof at !== 'string' || typeof id !== 'string') throw new Error('bad cursor')
    return { at, id }
  } catch {
    throw invalid('The cursor is not valid. Use the next_cursor value from the previous page.')
  }
}

export function pageRequest(params: URLSearchParams, defaults: { limit?: number } = {}): PageRequest {
  const raw = params.get('limit')
  const limit = raw === null ? defaults.limit ?? DEFAULT_PAGE_SIZE : Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw invalid(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`)
  }
  return { limit, cursor: decodeCursor(params.get('cursor')) }
}

/**
 * Builds a page from rows fetched with `limit + 1` ordered by (`key` desc, id desc).
 * Pass the same key you filtered the cursor on.
 */
export function toPage<T extends { id: string }>(rows: T[], request: PageRequest, key: (row: T) => string): Page<T> {
  const items = rows.slice(0, request.limit)
  const last = items[items.length - 1]
  return {
    items,
    nextCursor: rows.length > request.limit && last ? encodeCursor({ at: key(last), id: last.id }) : null,
  }
}

/** PostgREST `or` filter for keyset pagination in descending order. */
export function keysetFilter(column: string, cursor: Cursor): string {
  const at = cursor.at.replace(/"/g, '')
  const id = cursor.id.replace(/[^0-9a-f-]/gi, '')
  return `${column}.lt."${at}",and(${column}.eq."${at}",id.lt.${id})`
}
