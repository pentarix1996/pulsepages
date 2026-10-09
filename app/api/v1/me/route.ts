import { apiHandler, apiOptions } from '@/lib/http/api'
import { getMe } from '@/lib/domain/api-keys'

export const OPTIONS = apiOptions

/** The calling API key and its organization (api.md "Me"). Useful to check a key in CI. */
export const GET = apiHandler({ scope: 'read' }, async ({ ctx }) => ({ data: await getMe(ctx) }))
