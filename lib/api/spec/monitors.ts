import { operation, resource } from '../openapi'
import {
  checkResultResource,
  heartbeatFailInput,
  heartbeatResultResource,
  monitorCreateInput,
  monitorListQuery,
  monitorResource,
  monitorResultsQuery,
  monitorRunResource,
  monitorUpdateInput,
} from '@/lib/domain/schemas/monitors'

resource('Monitor', monitorResource)
resource('CheckResult', checkResultResource)
resource('MonitorRun', monitorRunResource)
resource('HeartbeatResult', heartbeatResultResource)

const tag = 'Monitors'

operation({ method: 'get', path: '/projects/{project}/monitors', operationId: 'listMonitors', summary: 'List monitors', description: 'Newest first. Filter by `state` and `type` (comma-separated).', tag, scope: 'read', query: monitorListQuery, response: 'Monitor', list: true })
operation({
  method: 'post',
  path: '/projects/{project}/monitors',
  operationId: 'createMonitor',
  summary: 'Create a monitor',
  description:
    '`config` depends on `type`. URLs and hosts must resolve to public addresses. The plan sets the minimum interval, the number of regions and of active monitors (`402 plan_limit`). `secret_headers` are encrypted and never returned; `heartbeat_url` is returned for heartbeat monitors.',
  tag,
  scope: 'write',
  body: monitorCreateInput,
  response: 'Monitor',
  status: 201,
  idempotent: true,
})
operation({ method: 'get', path: '/projects/{project}/monitors/{monitor}', operationId: 'getMonitor', summary: 'Get a monitor', tag, scope: 'read', response: 'Monitor' })
operation({
  method: 'patch',
  path: '/projects/{project}/monitors/{monitor}',
  operationId: 'updateMonitor',
  summary: 'Update a monitor',
  description: 'Send only what changes. `config` replaces the whole config; `enabled: false` pauses the monitor. `components` replaces the links.',
  tag,
  scope: 'write',
  body: monitorUpdateInput,
  response: 'Monitor',
})
operation({ method: 'delete', path: '/projects/{project}/monitors/{monitor}', operationId: 'deleteMonitor', summary: 'Delete a monitor', description: 'Its checks are deleted too; linked components return to their other signals.', tag, scope: 'write', status: 204 })
operation({
  method: 'post',
  path: '/projects/{project}/monitors/{monitor}/run',
  operationId: 'runMonitor',
  summary: 'Run a check now',
  description: 'Checks every region right away and returns one result per region. `409 conflict` when the monitor ran a few seconds ago.',
  tag,
  scope: 'write',
  response: 'MonitorRun',
  idempotent: true,
})
operation({ method: 'get', path: '/projects/{project}/monitors/{monitor}/results', operationId: 'listMonitorResults', summary: 'List check results', description: 'Newest first. Raw results are kept 7 days on Free, 14 on Pro and 30 on Business.', tag, scope: 'read', query: monitorResultsQuery, response: 'CheckResult', list: true })

const heartbeatTag = 'Heartbeats'
const heartbeatAuth = 'No API key: the token in the URL is the secret. Rate limited to 60 requests per minute per token.'
operation({ method: 'get', path: '/heartbeat/{token}', operationId: 'pingHeartbeat', summary: 'Report a successful run', description: `Call it when the job succeeds (GET, POST or HEAD). ${heartbeatAuth}`, tag: heartbeatTag, scope: 'none', response: 'HeartbeatResult' })
operation({ method: 'post', path: '/heartbeat/{token}', operationId: 'pingHeartbeatPost', summary: 'Report a successful run (POST)', description: heartbeatAuth, tag: heartbeatTag, scope: 'none', response: 'HeartbeatResult' })
operation({
  method: 'get',
  path: '/heartbeat/{token}/fail',
  operationId: 'failHeartbeat',
  summary: 'Report a failed run',
  description: `The monitor goes down right away. Pass the reason as \`?message=\`. ${heartbeatAuth}`,
  tag: heartbeatTag,
  scope: 'none',
  query: heartbeatFailInput,
  response: 'HeartbeatResult',
})
operation({ method: 'post', path: '/heartbeat/{token}/fail', operationId: 'failHeartbeatPost', summary: 'Report a failed run (POST)', description: `Body \`{ "message": "…" }\` or plain text. ${heartbeatAuth}`, tag: heartbeatTag, scope: 'none', body: heartbeatFailInput, response: 'HeartbeatResult' })
