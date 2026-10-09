import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { callbackUrl } from '@/components/auth/safe-next'
import { changeEmail } from '@/lib/domain/account'
import { emailChangeInput } from '@/lib/domain/schemas/account'
import { env } from '@/lib/env'

/** Starts an email change; `changed: false` when the address is the current one (B-6). */
export const POST = appHandler(async ({ ctx, request }) => {
  const input = await readJson(request, emailChangeInput)
  return { data: await changeEmail(ctx, input, callbackUrl(env.appUrl(), '/settings/account')) }
})
