import '@/lib/api/spec'
import { buildOpenApiDocument } from '@/lib/api/openapi'
import { CORS_HEADERS } from '@/lib/http/api'
import { env } from '@/lib/env'

export const dynamic = 'force-static'

export function GET(): Response {
  const serverUrl = env.apiHost() ? `https://${env.apiHost()}/v1` : `${env.appUrl()}/api/v1`
  return Response.json(buildOpenApiDocument({ serverUrl }), { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' } })
}
