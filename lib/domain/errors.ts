// Errors raised by the domain layer. Route handlers turn them into `{ error, code }` JSON (spec §8).

export type DomainErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'plan_required'
  | 'plan_limit'
  | 'not_found'
  | 'invalid_request'
  | 'conflict'
  | 'rate_limited'
  | 'idempotency_conflict'
  | 'unavailable'
  | 'internal'

const STATUS: Record<DomainErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  plan_required: 402,
  plan_limit: 402,
  not_found: 404,
  invalid_request: 422,
  conflict: 409,
  rate_limited: 429,
  idempotency_conflict: 409,
  unavailable: 503,
  internal: 500,
}

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.status = STATUS[code]
    this.details = details
  }
}

export const unauthorized = (message = 'Sign in to continue.') => new DomainError('unauthorized', message)
export const forbidden = (message = 'You do not have permission to do this.') => new DomainError('forbidden', message)
export const notFound = (what = 'Resource') => new DomainError('not_found', `${what} not found.`)
export const invalid = (message: string, details?: unknown) => new DomainError('invalid_request', message, details)
export const conflict = (message: string) => new DomainError('conflict', message)

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError
}

interface PostgrestLikeError {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const PLAN_PATTERN = /\bplan\b|upgrade|requires the (pro|business)/i

/** Maps Postgres/PostgREST errors raised by RLS, triggers and RPCs to domain errors with readable messages. */
export function fromDatabaseError(error: PostgrestLikeError | null | undefined, fallbackWhat = 'Resource'): DomainError {
  if (!error) return new DomainError('internal', 'Something went wrong.')
  const message = (error.message ?? '').trim()
  switch (error.code) {
    case '42501':
      // RLS violations come back as "new row violates row-level security policy"; do not leak table names.
      return forbidden(/row-level security|permission denied/i.test(message) ? 'You do not have permission to do this.' : message)
    case 'P0002':
    case 'PGRST116':
      return new DomainError('not_found', message && error.code === 'P0002' ? message : `${fallbackWhat} not found.`)
    case 'P0001':
      return PLAN_PATTERN.test(message) ? new DomainError('plan_limit', message) : conflict(message)
    case '23505':
      return conflict(describeUniqueViolation(error))
    case '23503':
      return invalid(message.startsWith('insert or update') || message.startsWith('update or delete') ? 'A referenced item does not exist or belongs to another status page.' : message)
    case '23514':
      return invalid(message.startsWith('new row') ? 'Some values are not allowed.' : message)
    case '23502':
      return invalid('A required value is missing.')
    case '22023':
    case '22007':
    case '22008':
      return invalid(message)
    case '22P02':
      return invalid('An identifier or value has the wrong format.')
    case 'PGRST301':
    case 'PGRST302':
      return unauthorized()
    default:
      return new DomainError('internal', 'Something went wrong. Try again in a moment.', { code: error.code, message })
  }
}

function describeUniqueViolation(error: PostgrestLikeError): string {
  const text = `${error.message ?? ''} ${error.details ?? ''}`
  if (/slug/.test(text)) return 'That key is already in use. Choose another one.'
  if (/email/.test(text)) return 'That email address is already on the list.'
  if (/custom_domain/.test(text)) return 'That domain is already connected to another status page.'
  if (/unsubscribe_token_hash/.test(text)) return 'This target is already subscribed.'
  return 'That already exists.'
}

/** Throws a DomainError when a Supabase response carries an error; returns the data otherwise. */
export function unwrap<T>(result: { data: T; error: PostgrestLikeError | null }, what?: string): T {
  if (result.error) throw fromDatabaseError(result.error, what)
  return result.data
}

/** Like unwrap, but also throws not_found for null data (single row reads). */
export function unwrapOne<T>(result: { data: T | null; error: PostgrestLikeError | null }, what = 'Resource'): T {
  if (result.error) throw fromDatabaseError(result.error, what)
  if (result.data === null || result.data === undefined) throw notFound(what)
  return result.data
}
