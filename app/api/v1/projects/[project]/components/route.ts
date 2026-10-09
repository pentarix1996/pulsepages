import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { createComponent, listComponents } from '@/lib/domain/components'
import { componentCreateInput } from '@/lib/domain/schemas/components'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => {
  const { components } = await listComponents(ctx, params.project)
  return { data: components, nextCursor: null }
})

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, componentCreateInput)
  return { data: await createComponent(ctx, params.project, input), status: 201 }
})
