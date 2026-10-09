import 'server-only'
import type { NextRequest } from 'next/server'
import { userContext, type DomainContext } from '@/lib/domain/context'
import { forbidden } from '@/lib/domain/errors'
import { env } from '@/lib/env'
import { errorJson } from './responses'

type Params = Record<string, string | string[]>

export interface AppHandlerArgs<P extends Params> {
  request: NextRequest
  params: P
  ctx: DomainContext
}

/** Return value of a handler: plain data (wrapped as `{ data }`), or a Response for full control. */
export type AppHandlerResult = Response | { data: unknown; status?: number } | void

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Cookie-authenticated mutations must come from our own pages (defense in depth on top of SameSite=Lax). */
function assertSameOrigin(request: NextRequest): void {
  if (SAFE_METHODS.has(request.method)) return
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') throw forbidden('Cross-site requests are not allowed.')
  const origin = request.headers.get('origin')
  if (!origin) return
  const allowed = new Set([new URL(request.url).origin, env.appUrl()])
  if (!allowed.has(origin)) throw forbidden('Cross-site requests are not allowed.')
}

/**
 * Route handler for the dashboard's internal API (`/api/app/**`): session auth, same-origin check, JSON envelope
 * `{ data }` and `{ error, code }` on failure.
 */
export function appHandler<P extends Params = Record<string, never>>(handler: (args: AppHandlerArgs<P>) => Promise<AppHandlerResult>) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      assertSameOrigin(request)
      const ctx = await userContext(request)
      const params = (await context.params) ?? ({} as P)
      const result = await handler({ request, params, ctx })
      if (result instanceof Response) return result
      if (!result) return new Response(null, { status: 204 })
      return Response.json({ data: result.data }, { status: result.status ?? 200, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      return errorJson(error, { 'Cache-Control': 'no-store' })
    }
  }
}
