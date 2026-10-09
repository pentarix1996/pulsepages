import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { createProject, listProjects } from '@/lib/domain/projects'
import { projectCreateInput } from '@/lib/domain/schemas/projects'

export const OPTIONS = apiOptions

export const GET = apiHandler({ scope: 'read' }, async ({ ctx }) => ({ data: await listProjects(ctx), nextCursor: null }))

/** Organization-wide keys only; the slug is generated from the name when omitted. */
export const POST = apiHandler({ scope: 'write', idempotent: true }, async ({ ctx, request }) => {
  const input = await readJson(request, projectCreateInput)
  return { data: await createProject(ctx, input), status: 201 }
})
