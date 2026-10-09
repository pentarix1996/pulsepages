import { appHandler } from '@/lib/http/app'
import { revokeAccessToken } from '@/lib/domain/access-tokens'

/** Revokes the link (kept in the list for the record). */
export const DELETE = appHandler<{ projectId: string; tokenId: string }>(async ({ ctx, params }) => ({ data: await revokeAccessToken(ctx, params.projectId, params.tokenId) }))
