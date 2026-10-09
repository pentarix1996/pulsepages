import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createAccessToken, listAccessTokens } from '@/lib/domain/access-tokens'
import { accessTokenCreateInput } from '@/lib/domain/schemas/status-page'

type P = { projectId: string }

export const GET = appHandler<P>(async ({ ctx, params }) => ({ data: await listAccessTokens(ctx, params.projectId) }))

export const POST = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, accessTokenCreateInput)
  return { data: await createAccessToken(ctx, params.projectId, input), status: 201 }
})
