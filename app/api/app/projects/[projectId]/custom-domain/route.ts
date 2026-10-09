import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { getCustomDomain, setCustomDomain } from '@/lib/domain/custom-domains'
import { customDomainInput } from '@/lib/domain/schemas/status-page'

type P = { projectId: string }

export const GET = appHandler<P>(async ({ ctx, params }) => ({ data: await getCustomDomain(ctx, params.projectId) }))

/** Connects or replaces the domain and checks it right away. */
export const PUT = appHandler<P>(async ({ ctx, params, request }) => {
  const { domain } = await readJson(request, customDomainInput)
  const { state } = await setCustomDomain(ctx, params.projectId, domain)
  return { data: state }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  const { state } = await setCustomDomain(ctx, params.projectId, null)
  return { data: state }
})
