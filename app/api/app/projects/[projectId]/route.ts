import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteProject, getProject, updateProject } from '@/lib/domain/projects'
import { projectUpdateInput } from '@/lib/domain/schemas/projects'

type P = { projectId: string }

export const GET = appHandler<P>(async ({ ctx, params }) => ({ data: await getProject(ctx, params.projectId) }))

/**
 * Status page settings (admin): name, slug, description, visibility, timezone, support URL, theme, branding,
 * allowed IPs, custom domain (null removes it; a change restarts verification) and uptime weights.
 */
export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, projectUpdateInput)
  return { data: await updateProject(ctx, params.projectId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteProject(ctx, params.projectId)
})
