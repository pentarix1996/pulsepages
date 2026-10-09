import { operation, resource, resources } from '../openapi'
import { subscriberCreateInput, subscriberListQuery, subscriberResource } from '@/lib/domain/schemas/subscribers'
import { projectSettingsResource } from '@/lib/domain/schemas/status-page'

resource('Subscriber', subscriberResource)

const tag = 'Subscribers'

operation({
  method: 'get',
  path: '/projects/{project}/subscribers',
  operationId: 'listSubscribers',
  summary: 'List subscribers',
  description: 'Subscriber lists contain personal data, so this needs a key with the write scope. Newest first.',
  tag,
  scope: 'write',
  query: subscriberListQuery,
  response: 'Subscriber',
  list: true,
})
operation({
  method: 'post',
  path: '/projects/{project}/subscribers',
  operationId: 'createSubscriber',
  summary: 'Add a subscriber',
  description:
    'Email subscribers receive a confirmation email and get updates once they confirm. Slack and webhook subscribers are active right away. Returns 200 when the email address was already confirmed. Plan limits apply.',
  tag,
  scope: 'write',
  body: subscriberCreateInput,
  response: 'Subscriber',
  status: 201,
  idempotent: true,
})
operation({ method: 'delete', path: '/projects/{project}/subscribers/{subscriber}', operationId: 'deleteSubscriber', summary: 'Remove a subscriber', tag, scope: 'write', status: 204 })

// Status page extra owned by this slice; the Project schema itself is registered by the projects area.
operation({
  method: 'post',
  path: '/projects/{project}/custom-domain/verify',
  operationId: 'verifyCustomDomain',
  summary: 'Verify the custom domain',
  description: 'Re-checks DNS (or the Vercel domain) and updates `custom_domain_status`: verified, pending (with what is missing in `custom_domain_error`) or error.',
  tag: 'Projects',
  scope: 'write',
  response: resources.has('Project') ? 'Project' : projectSettingsResource,
})
