import { appHandler } from '@/lib/http/app'
import { verifyCustomDomain } from '@/lib/domain/custom-domains'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params }) => {
  const { state } = await verifyCustomDomain(ctx, params.projectId)
  return { data: state }
})
