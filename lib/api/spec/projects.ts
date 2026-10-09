import { operation, resource } from '../openapi'
import { projectCreateInput, projectResource, projectStatusResource, projectUpdateInput } from '@/lib/domain/schemas/projects'

resource('Project', projectResource)
resource('ProjectStatus', projectStatusResource)

const tag = 'Status pages'

operation({ method: 'get', path: '/projects', operationId: 'listProjects', summary: 'List status pages', description: 'Every status page of the key’s organization, or only its page for keys limited to one page.', tag, scope: 'read', response: 'Project', list: true })
operation({
  method: 'post',
  path: '/projects',
  operationId: 'createProject',
  summary: 'Create a status page',
  description: 'Organization-wide keys only. The slug is generated from the name when omitted. Plan limits apply (`402 plan_limit`): pages per plan, private pages on Business, branding and custom domains on Pro.',
  tag,
  scope: 'write',
  body: projectCreateInput,
  response: 'Project',
  status: 201,
  idempotent: true,
})
operation({ method: 'get', path: '/projects/{project}', operationId: 'getProject', summary: 'Get a status page', tag, scope: 'read', response: 'Project' })
operation({
  method: 'patch',
  path: '/projects/{project}',
  operationId: 'updateProject',
  summary: 'Update a status page',
  description: 'Changing `custom_domain` restarts verification (`custom_domain_status` becomes `pending`). Changing `slug` changes the public URL.',
  tag,
  scope: 'write',
  body: projectUpdateInput,
  response: 'Project',
})
operation({ method: 'delete', path: '/projects/{project}', operationId: 'deleteProject', summary: 'Delete a status page', description: 'Deletes the page with its components, incidents, monitors, subscribers and history. This cannot be undone.', tag, scope: 'write', status: 204 })
operation({
  method: 'get',
  path: '/projects/{project}/status',
  operationId: 'getProjectStatus',
  summary: 'Current status',
  description: 'Overall status (worst component) with the headline the page shows, every component, active incidents and active or upcoming maintenance.',
  tag,
  scope: 'read',
  response: 'ProjectStatus',
})
