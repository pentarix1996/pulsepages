import { appHandler } from '@/lib/http/app'
import { revokeInvitation } from '@/lib/domain/invitations'

export const DELETE = appHandler<{ invitationId: string }>(async ({ ctx, params }) => {
  await revokeInvitation(ctx, params.invitationId)
})
