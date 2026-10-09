import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { changePassword } from '@/lib/domain/account'
import { passwordChangeInput } from '@/lib/domain/schemas/account'

export const POST = appHandler(async ({ ctx, request }) => {
  await changePassword(ctx, await readJson(request, passwordChangeInput))
})
