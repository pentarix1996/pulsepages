import { operation, resource } from '../openapi'
import { componentUptimeResource, metricsQuery, projectMetricsResource, sloCreateInput, sloResource, sloUpdateInput, uptimeQuery } from '@/lib/domain/schemas/metrics'

resource('ProjectMetrics', projectMetricsResource)
resource('ComponentUptime', componentUptimeResource)
resource('Slo', sloResource)

const tag = 'Metrics and SLOs'

operation({
  method: 'get',
  path: '/projects/{project}/metrics',
  operationId: 'getProjectMetrics',
  summary: 'Uptime, MTTA, MTTR and SLOs',
  description:
    'Uptime per component for the range (major outages count fully, partial outages and degraded time by the page weights, maintenance never), incidents detected in the range with MTTA and MTTR, and the current error budget of every SLO. Ranges of up to 400 days.',
  tag,
  scope: 'read',
  query: metricsQuery,
  response: 'ProjectMetrics',
})
operation({
  method: 'get',
  path: '/projects/{project}/uptime',
  operationId: 'getProjectUptime',
  summary: 'Daily uptime per component',
  description: 'One entry per component with its uptime and one row per day (worst status and weighted downtime), in the status page time zone. Same data as the 90-day bars on the page.',
  tag,
  scope: 'read',
  query: uptimeQuery,
  response: 'ComponentUptime',
  list: true,
})

operation({ method: 'get', path: '/projects/{project}/slos', operationId: 'listSlos', summary: 'List SLOs', description: 'SLOs with their current error budget over the rolling window.', tag, scope: 'read', response: 'Slo', list: true })
operation({ method: 'post', path: '/projects/{project}/slos', operationId: 'createSlo', summary: 'Create an SLO', tag, scope: 'write', body: sloCreateInput, response: 'Slo', status: 201, idempotent: true })
operation({ method: 'get', path: '/projects/{project}/slos/{slo}', operationId: 'getSlo', summary: 'Get an SLO', tag, scope: 'read', response: 'Slo' })
operation({ method: 'patch', path: '/projects/{project}/slos/{slo}', operationId: 'updateSlo', summary: 'Update an SLO', tag, scope: 'write', body: sloUpdateInput, response: 'Slo' })
operation({ method: 'delete', path: '/projects/{project}/slos/{slo}', operationId: 'deleteSlo', summary: 'Delete an SLO', tag, scope: 'write', status: 204 })
