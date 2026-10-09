import { appHandler } from '@/lib/http/app'
import { revokeApiKey } from '@/lib/domain/api-keys'

/** Revokes the key (sets revoked_at); requests with it fail right away. */
export const DELETE = appHandler<{ keyId: string }>(async ({ ctx, params }) => {
  await revokeApiKey(ctx, params.keyId)
})
