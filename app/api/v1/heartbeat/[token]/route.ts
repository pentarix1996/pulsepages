import { apiOptions, tokenHandler } from '@/lib/http/api'
import { systemContext } from '@/lib/domain/context'
import { recordHeartbeat, tokenBucket } from '@/lib/domain/heartbeats'

// Success ping from a job: GET, POST or HEAD /api/v1/heartbeat/{token}. No API key; the token is the secret.

type P = { token: string }

const ping = tokenHandler<P>({ bucket: (params) => tokenBucket('heartbeat', params.token), limitPerMinute: 60 }, async ({ params }) => ({
  data: await recordHeartbeat(systemContext('Heartbeat'), params.token, { success: true }),
}))

export const GET = ping
export const POST = ping
export const HEAD = ping
export const OPTIONS = apiOptions
