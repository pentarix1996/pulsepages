import { appHandler } from '@/lib/http/app'
import { resendInvitation } from '@/lib/domain/invitations'

export const POST = appHandler<{ invitationId: string }>(async ({ ctx, params }) => ({ data: await resendInvitation(ctx, params.invitationId) }))
