import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createOrganization } from '@/lib/domain/organizations'
import { organizationCreateInput } from '@/lib/domain/schemas/organizations'

export const POST = appHandler(async ({ ctx, request }) => {
  const input = await readJson(request, organizationCreateInput)
  return { data: await createOrganization(ctx, input), status: 201 }
})
