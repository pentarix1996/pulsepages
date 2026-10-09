import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { changeMemberRole, removeMember } from '@/lib/domain/members'
import { memberRoleInput } from '@/lib/domain/schemas/organizations'

type P = { organizationId: string; userId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const { role } = await readJson(request, memberRoleInput)
  return { data: await changeMemberRole(ctx, params.organizationId, params.userId, role) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await removeMember(ctx, params.organizationId, params.userId)
})
