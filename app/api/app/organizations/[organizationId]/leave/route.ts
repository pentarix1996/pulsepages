import { appHandler } from '@/lib/http/app'
import { leaveOrganization } from '@/lib/domain/organizations'

export const POST = appHandler<{ organizationId: string }>(async ({ ctx, params }) => {
  await leaveOrganization(ctx, params.organizationId)
})
