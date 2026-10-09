import { apiHandler, apiOptions } from '@/lib/http/api'
import { verifyCustomDomain } from '@/lib/domain/custom-domains'
import { toProjectSettingsResource } from '@/lib/domain/status-page-settings'

type P = { project: string }

export const OPTIONS = apiOptions

export const POST = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  const { project, access } = await verifyCustomDomain(ctx, params.project)
  return { data: toProjectSettingsResource(project, access.organization) }
})
