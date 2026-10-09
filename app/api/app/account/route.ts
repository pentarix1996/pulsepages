import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { getAccount, updateAccountName } from '@/lib/domain/account'
import { accountUpdateInput } from '@/lib/domain/schemas/account'

export const GET = appHandler(async ({ ctx }) => ({ data: await getAccount(ctx) }))

export const PATCH = appHandler(async ({ ctx, request }) => {
  const input = await readJson(request, accountUpdateInput)
  return { data: await updateAccountName(ctx, input) }
})
