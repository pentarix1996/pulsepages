import { operation, resource } from '../openapi'
import {
  componentCreateInput,
  componentGroupResource,
  componentResource,
  componentUpdateInput,
  dependenciesInput,
  groupCreateInput,
  groupUpdateInput,
  manualStatusInput,
} from '@/lib/domain/schemas/components'

resource('Component', componentResource)
resource('ComponentGroup', componentGroupResource)

const tag = 'Components'

operation({ method: 'get', path: '/projects/{project}/components', operationId: 'listComponents', summary: 'List components', tag, scope: 'read', response: 'Component', list: true })
operation({ method: 'post', path: '/projects/{project}/components', operationId: 'createComponent', summary: 'Create a component', tag, scope: 'write', body: componentCreateInput, response: 'Component', status: 201, idempotent: true })
operation({ method: 'get', path: '/projects/{project}/components/{component}', operationId: 'getComponent', summary: 'Get a component', tag, scope: 'read', response: 'Component' })
operation({ method: 'patch', path: '/projects/{project}/components/{component}', operationId: 'updateComponent', summary: 'Update a component', tag, scope: 'write', body: componentUpdateInput, response: 'Component' })
operation({ method: 'delete', path: '/projects/{project}/components/{component}', operationId: 'deleteComponent', summary: 'Delete a component', tag, scope: 'write', status: 204 })
operation({
  method: 'put',
  path: '/projects/{project}/components/{component}/status',
  operationId: 'setComponentStatus',
  summary: 'Pin or unpin a status',
  description: 'Pins a manual status that overrides monitors until cleared. Send `null` to return to automatic status. Incidents and maintenance windows still take precedence.',
  tag,
  scope: 'write',
  body: manualStatusInput,
  response: 'Component',
})
operation({ method: 'put', path: '/projects/{project}/components/{component}/dependencies', operationId: 'setComponentDependencies', summary: 'Replace dependencies', description: 'When a dependency has a major outage this component shows `impact`; a degraded or partial dependency degrades it.', tag, scope: 'write', body: dependenciesInput, response: 'Component' })

operation({ method: 'get', path: '/projects/{project}/component-groups', operationId: 'listComponentGroups', summary: 'List component groups', tag, scope: 'read', response: 'ComponentGroup', list: true })
operation({ method: 'post', path: '/projects/{project}/component-groups', operationId: 'createComponentGroup', summary: 'Create a group', tag, scope: 'write', body: groupCreateInput, response: 'ComponentGroup', status: 201, idempotent: true })
operation({ method: 'patch', path: '/projects/{project}/component-groups/{group}', operationId: 'updateComponentGroup', summary: 'Update a group', tag, scope: 'write', body: groupUpdateInput, response: 'ComponentGroup' })
operation({ method: 'delete', path: '/projects/{project}/component-groups/{group}', operationId: 'deleteComponentGroup', summary: 'Delete a group', description: 'Components in the group are kept and become ungrouped.', tag, scope: 'write', status: 204 })
