import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createProject } from '@/lib/domain/projects'
import { projectCreateInput } from '@/lib/domain/schemas/projects'

/** "New status page": the user must be an admin of `organization_id`; plan limits apply in the database. */
export const POST = appHandler(async ({ ctx, request }) => {
  const input = await readJson(request, projectCreateInput)
  return { data: await createProject(ctx, input), status: 201 }
})
