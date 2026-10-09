import { apiOptions, tokenHandler } from '@/lib/http/api'
import { systemContext } from '@/lib/domain/context'
import { invalid } from '@/lib/domain/errors'
import { tokenBucket } from '@/lib/domain/heartbeats'
import { MAX_INBOUND_BYTES, receiveInboundAlerts } from '@/lib/domain/integrations'

// External alerts (Alertmanager, Grafana, Datadog, CloudWatch via SNS, generic JSON): POST /api/v1/inbound/{token}.
// No API key; the token is the secret. SNS posts JSON as text/plain, so the body is read as text whatever the type.

type P = { token: string }

export const POST = tokenHandler<P>({ bucket: (params) => tokenBucket('inbound', params.token), limitPerMinute: 120 }, async ({ request, params }) => {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_INBOUND_BYTES) throw invalid('The payload is larger than 1 MB.')
  const body = await request.text()
  return { data: await receiveInboundAlerts(systemContext('Inbound integration'), params.token, { body }) }
})

export const OPTIONS = apiOptions
