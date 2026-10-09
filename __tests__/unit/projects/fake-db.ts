// Minimal chainable stand-in for the Supabase query builder used by lib/domain. Every awaited query is recorded
// and answered by `respond`, so tests can assert what was written and feed what is read.
import type { DomainContext } from '@/lib/domain/context'

export interface QueryCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc'
  payload?: unknown
  columns?: string
  filters: Array<{ method: string; args: unknown[] }>
  single?: 'single' | 'maybeSingle'
}

export interface QueryResult {
  data?: unknown
  error?: { code?: string; message?: string; details?: string | null } | null
  count?: number | null
}

export type Responder = (call: QueryCall) => QueryResult | undefined

const FILTERS = ['eq', 'neq', 'in', 'is', 'not', 'gte', 'gt', 'lt', 'lte', 'ilike', 'like', 'or', 'order', 'limit', 'range', 'contains', 'overlaps']

export function fakeDb(respond: Responder) {
  const calls: QueryCall[] = []
  const answer = (call: QueryCall) => {
    calls.push(call)
    const result = respond(call) ?? {}
    return { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }
  }

  const builder = (table: string) => {
    const call: QueryCall = { table, op: 'select', filters: [] }
    const chain: Record<string, unknown> = {}
    chain.select = (columns?: string) => {
      if (call.op === 'select') call.columns = columns
      else call.columns = columns ?? '*'
      return chain
    }
    for (const op of ['insert', 'update', 'delete', 'upsert'] as const) {
      chain[op] = (payload?: unknown) => {
        call.op = op
        call.payload = payload
        return chain
      }
    }
    for (const method of FILTERS) {
      chain[method] = (...args: unknown[]) => {
        call.filters.push({ method, args })
        return chain
      }
    }
    chain.single = () => {
      call.single = 'single'
      return chain
    }
    chain.maybeSingle = () => {
      call.single = 'maybeSingle'
      return chain
    }
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(answer(call)).then(resolve, reject)
    return chain
  }

  const db = {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) => Promise.resolve(answer({ table: name, op: 'rpc', payload: args, filters: [] })),
  }
  return { db, calls }
}

export function filterValue(call: QueryCall, method: string, column: string): unknown {
  return call.filters.find((filter) => filter.method === method && filter.args[0] === column)?.args[1]
}

export function userCtx(db: unknown, id = 'user-1'): DomainContext {
  return {
    actor: { type: 'user', id, email: 'owner@example.com', label: 'Owner' },
    db: db as DomainContext['db'],
    admin: () => db as DomainContext['db'],
    ip: null,
    requestId: 'req_test',
  }
}

export function apiKeyCtx(db: unknown, options: { projectId?: string | null; scopes?: Array<'read' | 'write'>; organizationId?: string } = {}): DomainContext {
  return {
    actor: {
      type: 'api_key',
      id: 'key-1',
      label: 'API key CI',
      organizationId: options.organizationId ?? 'org-1',
      organizationSlug: 'quillbase',
      projectId: options.projectId ?? null,
      scopes: options.scopes ?? ['read', 'write'],
      plan: 'business',
      prefix: 'upv_live_',
    },
    db: db as DomainContext['db'],
    admin: () => db as DomainContext['db'],
    ip: null,
    requestId: 'req_test',
  }
}
