import 'server-only'
import { ZodError, type ZodType } from 'zod'
import { DomainError, invalid } from '@/lib/domain/errors'

export interface ErrorBody {
  error: string
  code: string
  details?: unknown
  request_id?: string
}

function issuesToDetails(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join('.') || '(body)', message: issue.message }))
}

function readableIssues(error: ZodError): string {
  const first = error.issues[0]
  if (!first) return 'The request is not valid.'
  const path = first.path.map(String).join('.')
  return path ? `${path}: ${first.message}` : first.message
}

export function toDomainError(error: unknown): DomainError {
  if (error instanceof DomainError) return error
  if (error instanceof ZodError) return invalid(readableIssues(error), issuesToDetails(error))
  console.error('[http] unexpected error', error)
  return new DomainError('internal', 'Something went wrong. Try again in a moment.')
}

export function errorJson(error: unknown, headers: HeadersInit = {}, requestId?: string): Response {
  const domain = toDomainError(error)
  const body: ErrorBody = { error: domain.message, code: domain.code }
  if (domain.code === 'invalid_request' && domain.details !== undefined) body.details = domain.details
  if (requestId) body.request_id = requestId
  return Response.json(body, { status: domain.status, headers })
}

/** Reads and validates a JSON body. Empty bodies validate as `{}`. */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown = {}
  const text = await request.text()
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text)
    } catch {
      throw invalid('The request body is not valid JSON.')
    }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw invalid(readableIssues(parsed.error), issuesToDetails(parsed.error))
  return parsed.data
}

export function readQuery<T>(url: URL, schema: ZodType<T>): T {
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    raw[key] = values.length > 1 ? values : values[0]!
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw invalid(readableIssues(parsed.error), issuesToDetails(parsed.error))
  return parsed.data
}
