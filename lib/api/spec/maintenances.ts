import { operation, resource } from '../openapi'
import {
  maintenanceActionInput,
  maintenanceCreateInput,
  maintenanceListQuery,
  maintenancePatchInput,
  maintenanceResource,
  maintenanceUpdateInput,
  maintenanceUpdateResource,
} from '@/lib/domain/schemas/maintenances'

resource('Maintenance', maintenanceResource)
resource('MaintenanceUpdate', maintenanceUpdateResource)

const tag = 'Maintenance windows'
const base = '/projects/{project}/maintenances'
const one = `${base}/{maintenance}`

operation({ method: 'get', path: base, operationId: 'listMaintenances', summary: 'List maintenance windows', tag, scope: 'read', query: maintenanceListQuery, response: 'Maintenance', list: true })
operation({
  method: 'post',
  path: base,
  operationId: 'createMaintenance',
  summary: 'Schedule maintenance',
  description: 'Affected components show "Under maintenance" while the window is in progress. With `auto_start` and `auto_complete` Upvane opens and closes it on time; a start in the past starts it right away.',
  tag,
  scope: 'write',
  body: maintenanceCreateInput,
  response: 'Maintenance',
  status: 201,
  idempotent: true,
})
operation({ method: 'get', path: one, operationId: 'getMaintenance', summary: 'Get a maintenance window', description: 'Includes its updates, newest first.', tag, scope: 'read', response: 'Maintenance' })
operation({ method: 'patch', path: one, operationId: 'updateMaintenance', summary: 'Edit a maintenance window', description: 'Only while it is scheduled or in progress. `components` replaces the list.', tag, scope: 'write', body: maintenancePatchInput, response: 'Maintenance' })
operation({ method: 'delete', path: one, operationId: 'cancelMaintenanceWindow', summary: 'Cancel a maintenance window', description: 'Same as `/cancel` without a message. The window stays in the history.', tag, scope: 'write', status: 204 })
operation({ method: 'post', path: `${one}/start`, operationId: 'startMaintenance', summary: 'Start now', description: 'Moves a scheduled window to in progress.', tag, scope: 'write', body: maintenanceActionInput, response: 'Maintenance', idempotent: true })
operation({ method: 'post', path: `${one}/complete`, operationId: 'completeMaintenance', summary: 'Complete', description: 'Closes a window in progress; components return to their automatic status.', tag, scope: 'write', body: maintenanceActionInput, response: 'Maintenance', idempotent: true })
operation({ method: 'post', path: `${one}/cancel`, operationId: 'cancelMaintenance', summary: 'Cancel', description: 'Cancels a scheduled window or stops one in progress.', tag, scope: 'write', body: maintenanceActionInput, response: 'Maintenance', idempotent: true })
operation({ method: 'post', path: `${one}/updates`, operationId: 'postMaintenanceUpdate', summary: 'Post an update', description: 'Adds a message to the window on the status page.', tag, scope: 'write', body: maintenanceUpdateInput, response: 'MaintenanceUpdate', status: 201, idempotent: true })
