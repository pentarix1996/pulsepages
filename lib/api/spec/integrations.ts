import { z } from 'zod'
import { operation, resource } from '../openapi'
import { inboundResultResource, integrationCreateInput, integrationResource, integrationUpdateInput } from '@/lib/domain/schemas/integrations'

resource('Integration', integrationResource)
resource('InboundResult', inboundResultResource)

const tag = 'Integrations'
const secretNote = 'Integration URLs contain a secret token, so these endpoints need a write key.'

operation({ method: 'get', path: '/projects/{project}/integrations', operationId: 'listIntegrations', summary: 'List inbound integrations', description: secretNote, tag, scope: 'write', response: 'Integration', list: true })
operation({
  method: 'post',
  path: '/projects/{project}/integrations',
  operationId: 'createIntegration',
  summary: 'Create an inbound integration',
  description: `Alerts sent to \`url\` set the status of components: the first mapping whose labels match wins, then a \`component\` label equal to a component key, then the default component. ${secretNote}`,
  tag,
  scope: 'write',
  body: integrationCreateInput,
  response: 'Integration',
  status: 201,
  idempotent: true,
})
operation({ method: 'get', path: '/projects/{project}/integrations/{integration}', operationId: 'getIntegration', summary: 'Get an inbound integration', description: secretNote, tag, scope: 'write', response: 'Integration' })
operation({ method: 'patch', path: '/projects/{project}/integrations/{integration}', operationId: 'updateIntegration', summary: 'Update an inbound integration', description: 'Disabling it resolves the alerts it has firing.', tag, scope: 'write', body: integrationUpdateInput, response: 'Integration' })
operation({ method: 'delete', path: '/projects/{project}/integrations/{integration}', operationId: 'deleteIntegration', summary: 'Delete an inbound integration', description: 'Its alerts stop affecting components.', tag, scope: 'write', status: 204 })
operation({
  method: 'post',
  path: '/inbound/{token}',
  operationId: 'receiveInboundAlerts',
  summary: 'Receive alerts from a provider',
  description:
    'Accepts the native webhook payload of the integration type: Prometheus Alertmanager (v4), Grafana Alerting, Datadog (with the template from the dashboard), Amazon CloudWatch through SNS (subscriptions are confirmed automatically) or generic JSON `{ external_id, status, active?, component?, summary?, labels? }` (or an array). No API key: the token is the secret. Rate limited to 120 requests per minute per token. Unreadable payloads return 422 and show up on the integration as `last_error`.',
  tag,
  scope: 'none',
  body: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]),
  response: 'InboundResult',
})
