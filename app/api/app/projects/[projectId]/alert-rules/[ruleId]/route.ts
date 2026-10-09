import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { deleteAlertRule, updateAlertRule } from '@/lib/domain/alerts'
import { alertRuleUpdateInput } from '@/lib/domain/schemas/alerts'

type P = { projectId: string; ruleId: string }

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, alertRuleUpdateInput)
  return { data: await updateAlertRule(ctx, params.projectId, params.ruleId, input) }
})

export const DELETE = appHandler<P>(async ({ ctx, params }) => {
  await deleteAlertRule(ctx, params.projectId, params.ruleId)
})
