import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createInvitation } from '@/lib/domain/invitations'
import { invitationCreateInput } from '@/lib/domain/schemas/organizations'

export const POST = appHandler(async ({ ctx, request }) => {
  const input = await readJson(request, invitationCreateInput)
  return { data: await createInvitation(ctx, input), status: 201 }
})
