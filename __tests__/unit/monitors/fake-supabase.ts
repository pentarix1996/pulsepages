// Minimal chainable stand-in for the supabase-js query builder, for domain tests. Every awaited query or rpc goes to
// `handler(call)`, which returns { data, error }. Calls are recorded for assertions.
import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DomainContext } from '@/lib/domain/context'

export interface FakeCall {
  client: string
  table: string
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
  columns?: string
  payload?: unknown
  filters: Array<[string, string, unknown]>
  single?: 'single' | 'maybeSingle'
}

export type FakeResult = { data: unknown; error: { code?: string; message?: string } | null }
export type FakeHandler = (call: FakeCall) => FakeResult | Promise<FakeResult>

export function fakeClient(name: string, handler: FakeHandler, calls: FakeCall[]): SupabaseClient {
  const from = (table: string) => {
    const call: FakeCall = { client: name, table, action: 'select', filters: [] }
    const builder: Record<string, unknown> = {}
    const chain = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
      fn(...args)
      return builder
    }
    Object.assign(builder, {
      select: chain((columns) => {
        if (call.action === 'select') call.columns = columns as string
      }),
      insert: chain((payload) => {
        call.action = 'insert'
        call.payload = payload
      }),
      update: chain((payload) => {
        call.action = 'update'
        call.payload = payload
      }),
      upsert: chain((payload) => {
        call.action = 'upsert'
        call.payload = payload
      }),
      delete: chain(() => {
        call.action = 'delete'
      }),
      eq: chain((column, value) => call.filters.push(['eq', column as string, value])),
      neq: chain((column, value) => call.filters.push(['neq', column as string, value])),
      in: chain((column, value) => call.filters.push(['in', column as string, value])),
      is: chain((column, value) => call.filters.push(['is', column as string, value])),
      or: chain((value) => call.filters.push(['or', '', value])),
      ilike: chain((column, value) => call.filters.push(['ilike', column as string, value])),
      order: chain(() => undefined),
      limit: chain(() => undefined),
      single: chain(() => {
        call.single = 'single'
      }),
      maybeSingle: chain(() => {
        call.single = 'maybeSingle'
      }),
      then: (resolve: (value: FakeResult) => unknown, reject: (reason: unknown) => unknown) => {
        calls.push(call)
        return Promise.resolve(handler(call)).then(resolve, reject)
      },
    })
    return builder
  }
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    const call: FakeCall = { client: name, table: `rpc:${fn}`, action: 'rpc', payload: args, filters: [] }
    calls.push(call)
    return handler(call)
  })
  return { from, rpc } as unknown as SupabaseClient
}

export function filterValue(call: FakeCall, column: string): unknown {
  return call.filters.find(([op, name]) => op === 'eq' && name === column)?.[2]
}

export const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
export const ORG_ID = '55555555-5555-4555-8555-555555555555'

export const projectRow = {
  id: PROJECT_ID,
  organization_id: ORG_ID,
  name: 'Quillbase',
  slug: 'status',
  auto_draft_incidents: true,
  organization: { id: ORG_ID, name: 'Quillbase', slug: 'quillbase', plan: 'business', personal: false, sso_domain: null, require_2fa: false },
}

export type Role = 'viewer' | 'responder' | 'admin' | 'owner'

/**
 * A dashboard user context with `role` in the project's organization. `handler` answers every other query;
 * projects and organization_members are answered here so the real requireProject() runs.
 */
export function userContext(role: Role, handler: FakeHandler) {
  const calls: FakeCall[] = []
  const base: FakeHandler = (call) => {
    if (call.table === 'projects' && call.action === 'select') return { data: projectRow, error: null }
    if (call.table === 'organization_members') return { data: { role }, error: null }
    return handler(call)
  }
  const db = fakeClient('db', base, calls)
  const admin = fakeClient('admin', handler, calls)
  const ctx: DomainContext = {
    actor: { type: 'user', id: '11111111-1111-4111-8111-111111111111', email: 'owner@upvane.test', label: 'Owner' },
    db,
    admin: () => admin,
    ip: null,
    requestId: 'req_test',
  }
  return { ctx, calls, admin }
}

/** Context used by token endpoints (heartbeats, inbound): system actor, everything through the admin client. */
export function systemTestContext(handler: FakeHandler) {
  const calls: FakeCall[] = []
  const admin = fakeClient('admin', handler, calls)
  const ctx: DomainContext = { actor: { type: 'system', id: null, label: 'Test' }, db: admin, admin: () => admin, ip: null, requestId: 'req_test' }
  return { ctx, calls, admin }
}
