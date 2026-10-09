import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { rotateApiKey } from '@/lib/domain/api-keys'
import { apiKeyRotateInput } from '@/lib/domain/schemas/api-keys'

export const POST = appHandler<{ keyId: string }>(async ({ ctx, params, request }) => {
  const { grace } = await readJson(request, apiKeyRotateInput)
  return { data: await rotateApiKey(ctx, params.keyId, grace), status: 201 }
})
