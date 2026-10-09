import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { BillingNotConfiguredError, changePlan } from '@/lib/domain/billing'
import { planChangeInput } from '@/lib/domain/schemas/organizations'

/** Owners change the plan here (C-4). BILLING_MODE=demo applies it directly; other modes answer 501. */
export const POST = appHandler(async ({ ctx, request }) => {
  const input = await readJson(request, planChangeInput)
  try {
    return { data: await changePlan(ctx, input) }
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) {
      return Response.json({ error: error.message, code: 'billing_not_configured' }, { status: 501, headers: { 'Cache-Control': 'no-store' } })
    }
    throw error
  }
})
