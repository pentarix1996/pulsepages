import { apiHandler, apiOptions } from '@/lib/http/api'
import { getProjectStatus } from '@/lib/domain/projects'

type P = { project: string }

export const OPTIONS = apiOptions

/** Overall status with headline, components, active incidents and active or upcoming maintenance. */
export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getProjectStatus(ctx, params.project) }))
