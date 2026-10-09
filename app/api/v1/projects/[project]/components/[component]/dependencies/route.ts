import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { setComponentDependencies } from '@/lib/domain/components'
import { dependenciesInput } from '@/lib/domain/schemas/components'

type P = { project: string; component: string }

export const OPTIONS = apiOptions

export const PUT = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, dependenciesInput)
  return { data: await setComponentDependencies(ctx, params.project, params.component, input) }
})
