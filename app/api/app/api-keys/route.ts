import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createApiKey } from '@/lib/domain/api-keys'
import { apiKeyCreateInput } from '@/lib/domain/schemas/api-keys'

/** Returns the secret once: `{ key, token }`. Only its hash is stored. */
export const POST = appHandler(async ({ ctx, request }) => {
  const input = await readJson(request, apiKeyCreateInput)
  return { data: await createApiKey(ctx, input), status: 201 }
})
