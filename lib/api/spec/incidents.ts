import { operation, resource } from '../openapi'
import {
  incidentCreateInput,
  incidentLegacyUpdateInput,
  incidentListQuery,
  incidentPatchInput,
  incidentPublishInput,
  incidentResource,
  incidentTemplateCreateInput,
  incidentTemplateResource,
  incidentTemplateUpdateInput,
  incidentUpdateInput,
  incidentUpdateResource,
} from '@/lib/domain/schemas/incidents'
import { postmortemInput, postmortemResource } from '@/lib/domain/schemas/postmortems'

resource('Incident', incidentResource)
resource('IncidentUpdate', incidentUpdateResource)
resource('Postmortem', postmortemResource)
resource('IncidentTemplate', incidentTemplateResource)

const tag = 'Incidents'
const base = '/projects/{project}/incidents'
const one = `${base}/{incident}`

operation({ method: 'get', path: base, operationId: 'listIncidents', summary: 'List incidents', description: 'Newest first. Deleted incidents are not listed.', tag, scope: 'read', query: incidentListQuery, response: 'Incident', list: true })
operation({
  method: 'post',
  path: base,
  operationId: 'createIncident',
  summary: 'Declare an incident',
  description:
    'Sets the status of each affected component until the incident is resolved and notifies subscribers. Send `status: "draft"` to prepare it privately; publish it later with `/publish`. v0 fields (`severity`, `component_ids`, `description`) are still accepted.',
  tag,
  scope: 'write',
  body: incidentCreateInput,
  response: 'Incident',
  status: 201,
  idempotent: true,
})
operation({ method: 'get', path: one, operationId: 'getIncident', summary: 'Get an incident', description: 'Includes the full timeline (public updates, internal notes and logged changes).', tag, scope: 'read', response: 'Incident' })
operation({ method: 'patch', path: one, operationId: 'updateIncident', summary: 'Rename or change impact', description: 'Changes are logged in the timeline. Use `/updates` to change the stage or component statuses.', tag, scope: 'write', body: incidentPatchInput, response: 'Incident' })
operation({
  method: 'put',
  path: one,
  operationId: 'updateIncidentLegacy',
  summary: 'Update an incident (v0)',
  description: 'v0 compatibility. Accepts the PATCH fields plus `severity`, and posts a public update when `message`, `status` or `component_ids` are sent.',
  tag,
  scope: 'write',
  body: incidentLegacyUpdateInput,
  response: 'Incident',
})
operation({ method: 'delete', path: one, operationId: 'deleteIncident', summary: 'Delete an incident', description: 'Removes it from the status page and gives its components back to monitors. Needs an admin (write) key.', tag, scope: 'write', status: 204 })
operation({
  method: 'post',
  path: `${one}/updates`,
  operationId: 'postIncidentUpdate',
  summary: 'Post an update',
  description: 'Public updates can move the stage and change component statuses (`null` removes a component). Internal notes only add to the timeline.',
  tag,
  scope: 'write',
  body: incidentUpdateInput,
  response: 'IncidentUpdate',
  status: 201,
  idempotent: true,
})
operation({ method: 'post', path: `${one}/acknowledge`, operationId: 'acknowledgeIncident', summary: 'Acknowledge an incident', description: 'Records who took it and when (time to acknowledge). Acknowledging twice keeps the first time.', tag, scope: 'write', response: 'Incident', idempotent: true })
operation({ method: 'post', path: `${one}/publish`, operationId: 'publishIncident', summary: 'Publish a draft', description: 'Makes a draft public with a first update and applies its component statuses. Only for drafts.', tag, scope: 'write', body: incidentPublishInput, response: 'Incident', idempotent: true })
operation({ method: 'get', path: `${one}/postmortem`, operationId: 'getPostmortem', summary: 'Get the postmortem', tag, scope: 'read', response: 'Postmortem' })
operation({ method: 'put', path: `${one}/postmortem`, operationId: 'savePostmortem', summary: 'Write the postmortem', description: 'Creates the draft (prefilled with the timeline) when there is none. Fields you omit keep their value; lists replace the stored ones.', tag, scope: 'write', body: postmortemInput, response: 'Postmortem' })
operation({ method: 'post', path: `${one}/postmortem/publish`, operationId: 'publishPostmortem', summary: 'Publish the postmortem', description: 'Shows it on the incident page of the status page. The incident must be resolved.', tag, scope: 'write', response: 'Postmortem', idempotent: true })
operation({ method: 'post', path: `${one}/postmortem/unpublish`, operationId: 'unpublishPostmortem', summary: 'Unpublish the postmortem', description: 'Takes it off the status page; it becomes a draft again.', tag, scope: 'write', response: 'Postmortem', idempotent: true })

const templates = '/projects/{project}/incident-templates'
operation({ method: 'get', path: templates, operationId: 'listIncidentTemplates', summary: 'List incident templates', tag, scope: 'read', response: 'IncidentTemplate', list: true })
operation({ method: 'post', path: templates, operationId: 'createIncidentTemplate', summary: 'Create an incident template', description: 'Templates prefill the title, message, impact, stage and component statuses of a new incident (`template_id`).', tag, scope: 'write', body: incidentTemplateCreateInput, response: 'IncidentTemplate', status: 201, idempotent: true })
operation({ method: 'get', path: `${templates}/{template}`, operationId: 'getIncidentTemplate', summary: 'Get an incident template', tag, scope: 'read', response: 'IncidentTemplate' })
operation({ method: 'patch', path: `${templates}/{template}`, operationId: 'updateIncidentTemplate', summary: 'Update an incident template', tag, scope: 'write', body: incidentTemplateUpdateInput, response: 'IncidentTemplate' })
operation({ method: 'delete', path: `${templates}/{template}`, operationId: 'deleteIncidentTemplate', summary: 'Delete an incident template', tag, scope: 'write', status: 204 })
