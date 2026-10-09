import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { resendRecipientVerification } from '@/lib/domain/alerts'
import { resendVerificationInput } from '@/lib/domain/schemas/alerts'

export const POST = appHandler<{ projectId: string; channelId: string }>(async ({ ctx, params, request }) => {
  const { email } = await readJson(request, resendVerificationInput)
  return { data: await resendRecipientVerification(ctx, params.projectId, params.channelId, email) }
})
