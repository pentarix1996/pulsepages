import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteComponent, getComponent, updateComponent } from '@/lib/domain/components'
import { componentUpdateInput } from '@/lib/domain/schemas/components'

type P = { project: string; component: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getComponent(ctx, params.project, params.component) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, componentUpdateInput)
  return { data: await updateComponent(ctx, params.project, params.component, input) }
})

/** v0 compatibility: PUT behaved like PATCH. */
export const PUT = PATCH

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteComponent(ctx, params.project, params.component)
})
