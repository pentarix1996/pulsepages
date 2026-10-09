import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { createAlertRule, listAlertRules } from '@/lib/domain/alerts'
import { alertRuleCreateInput } from '@/lib/domain/schemas/alerts'

type P = { project: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await listAlertRules(ctx, params.project), nextCursor: null }))

export const POST = apiHandler<P>({ scope: 'write', idempotent: true }, async ({ ctx, params, request }) => {
  const input = await readJson(request, alertRuleCreateInput)
  return { data: await createAlertRule(ctx, params.project, input), status: 201 }
})
