import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteOrganization, updateOrganization } from '@/lib/domain/organizations'
import { organizationDeleteInput, organizationUpdateInput } from '@/lib/domain/schemas/organizations'

type P = { organizationId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, organizationUpdateInput)
  return { data: await updateOrganization(ctx, params.organizationId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params, request }) => {
  const { confirm } = await readJson(request, organizationDeleteInput)
  await deleteOrganization(ctx, params.organizationId, confirm)
})
