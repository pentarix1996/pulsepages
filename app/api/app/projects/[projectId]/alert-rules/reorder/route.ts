import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { reorderAlertRules } from '@/lib/domain/alerts'
import { alertRuleReorderInput } from '@/lib/domain/schemas/alerts'

export const POST = appHandler<{ projectId: string }>(async ({ ctx, params, request }) => ({
  data: await reorderAlertRules(ctx, params.projectId, await readJson(request, alertRuleReorderInput)),
}))
