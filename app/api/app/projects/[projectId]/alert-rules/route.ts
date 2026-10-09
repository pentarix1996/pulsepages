import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { createAlertRule, listAlertRules } from '@/lib/domain/alerts'
import { alertRuleCreateInput } from '@/lib/domain/schemas/alerts'

type P = { projectId: string }

export const GET = appHandler<P>(async ({ ctx, params }) => ({ data: await listAlertRules(ctx, params.projectId) }))

export const POST = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, alertRuleCreateInput)
  return { data: await createAlertRule(ctx, params.projectId, input), status: 201 }
})
