import { operation, resource } from '../openapi'
import {
  alertChannelCreateInput,
  alertChannelResource,
  alertChannelUpdateInput,
  alertEventResource,
  alertEventsQuery,
  alertRuleCreateInput,
  alertRuleResource,
  alertRuleUpdateInput,
  alertTestResult,
} from '@/lib/domain/schemas/alerts'

resource('AlertChannel', alertChannelResource)
resource('AlertRule', alertRuleResource)
resource('AlertEvent', alertEventResource)

const tag = 'Alerts'

operation({ method: 'get', path: '/projects/{project}/alert-channels', operationId: 'listAlertChannels', summary: 'List alert channels', tag, scope: 'read', response: 'AlertChannel', list: true })
operation({
  method: 'post',
  path: '/projects/{project}/alert-channels',
  operationId: 'createAlertChannel',
  summary: 'Create an alert channel',
  description:
    'Secrets (webhook URLs, routing and API keys, signing secrets) are encrypted and never returned; `secret_hint` reminds you which one is stored. Email recipients who are not members of the organization get a confirmation email and only receive alerts after confirming. PagerDuty and Opsgenie require the Business plan.',
  tag,
  scope: 'write',
  body: alertChannelCreateInput,
  response: 'AlertChannel',
  status: 201,
  idempotent: true,
})
operation({ method: 'get', path: '/projects/{project}/alert-channels/{channel}', operationId: 'getAlertChannel', summary: 'Get an alert channel', tag, scope: 'read', response: 'AlertChannel' })
operation({
  method: 'patch',
  path: '/projects/{project}/alert-channels/{channel}',
  operationId: 'updateAlertChannel',
  summary: 'Update an alert channel',
  description: 'Omit `secret` to keep the stored one. `recipients` replaces the whole list of an email channel.',
  tag,
  scope: 'write',
  body: alertChannelUpdateInput,
  response: 'AlertChannel',
})
operation({ method: 'delete', path: '/projects/{project}/alert-channels/{channel}', operationId: 'deleteAlertChannel', summary: 'Delete an alert channel', description: 'Rules stop sending to it.', tag, scope: 'write', status: 204 })
operation({
  method: 'post',
  path: '/projects/{project}/alert-channels/{channel}/test',
  operationId: 'testAlertChannel',
  summary: 'Send a test alert',
  description: `Queues a test alert through this channel only, ignoring rules, the master switch and maintenance windows. Limited to 5 tests every 10 minutes per status page.`,
  tag,
  scope: 'write',
  response: alertTestResult,
  idempotent: true,
})

operation({ method: 'get', path: '/projects/{project}/alert-rules', operationId: 'listAlertRules', summary: 'List routing rules', description: 'Rules are evaluated in `position` order; a channel receives each event once.', tag, scope: 'read', response: 'AlertRule', list: true })
operation({ method: 'post', path: '/projects/{project}/alert-rules', operationId: 'createAlertRule', summary: 'Create a routing rule', tag, scope: 'write', body: alertRuleCreateInput, response: 'AlertRule', status: 201, idempotent: true })
operation({ method: 'get', path: '/projects/{project}/alert-rules/{rule}', operationId: 'getAlertRule', summary: 'Get a routing rule', tag, scope: 'read', response: 'AlertRule' })
operation({ method: 'patch', path: '/projects/{project}/alert-rules/{rule}', operationId: 'updateAlertRule', summary: 'Update a routing rule', tag, scope: 'write', body: alertRuleUpdateInput, response: 'AlertRule' })
operation({ method: 'delete', path: '/projects/{project}/alert-rules/{rule}', operationId: 'deleteAlertRule', summary: 'Delete a routing rule', tag, scope: 'write', status: 204 })

operation({
  method: 'get',
  path: '/projects/{project}/alert-events',
  operationId: 'listAlertEvents',
  summary: 'List alert events',
  description: 'Recent events for your team, newest first, with their deliveries. Suppressed events explain why in `suppression_reason`.',
  tag,
  scope: 'read',
  query: alertEventsQuery,
  response: 'AlertEvent',
  list: true,
})
