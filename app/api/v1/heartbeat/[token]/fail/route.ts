import { apiOptions, tokenHandler } from '@/lib/http/api'
import { systemContext } from '@/lib/domain/context'
import { failureMessageFrom, recordHeartbeat, tokenBucket } from '@/lib/domain/heartbeats'

// Failure ping: GET or POST /api/v1/heartbeat/{token}/fail with ?message=…, a JSON body { "message": "…" } or a
// plain-text body. The monitor goes down right away (no grace period).

type P = { token: string }

const fail = tokenHandler<P>({ bucket: (params) => tokenBucket('heartbeat', params.token), limitPerMinute: 60 }, async ({ request, url, params }) => {
  const body = request.method === 'POST' ? (await request.text()).slice(0, 10_000) : ''
  const message = failureMessageFrom(url.searchParams.get('message'), body, request.headers.get('content-type'))
  return { data: await recordHeartbeat(systemContext('Heartbeat'), params.token, { success: false, message }) }
})

export const GET = fail
export const POST = fail
export const OPTIONS = apiOptions
