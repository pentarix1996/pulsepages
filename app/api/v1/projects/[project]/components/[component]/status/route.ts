import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { setComponentManualStatus } from '@/lib/domain/components'
import { manualStatusInput } from '@/lib/domain/schemas/components'

type P = { project: string; component: string }

export const OPTIONS = apiOptions

export const PUT = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const { status } = await readJson(request, manualStatusInput)
  return { data: await setComponentManualStatus(ctx, params.project, params.component, status) }
})
