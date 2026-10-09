import { operation, resource } from '../openapi'
import { meResource } from '@/lib/domain/schemas/api-keys'

resource('Me', meResource)

operation({
  method: 'get',
  path: '/me',
  operationId: 'getMe',
  summary: 'Describe the API key',
  description: 'Returns the key that made the request (name, prefix, scopes and the status page it is limited to) and its organization. Use it to check that a key works.',
  tag: 'Account',
  scope: 'read',
  response: 'Me',
})
