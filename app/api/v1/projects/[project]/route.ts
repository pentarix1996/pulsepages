import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteProject, getProject, updateProject } from '@/lib/domain/projects'
import { projectUpdateInput } from '@/lib/domain/schemas/projects'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getProject(ctx, params.project) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, projectUpdateInput)
  return { data: await updateProject(ctx, params.project, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteProject(ctx, params.project)
})
