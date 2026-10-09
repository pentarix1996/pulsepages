import { apiHandler, apiOptions } from '@/lib/http/api'
import { readJson } from '@/lib/http/responses'
import { deleteAlertRule, getAlertRule, updateAlertRule } from '@/lib/domain/alerts'
import { alertRuleUpdateInput } from '@/lib/domain/schemas/alerts'

type P = { project: string; rule: string }

export const OPTIONS = apiOptions

export const GET = apiHandler<P>({ scope: 'read' }, async ({ ctx, params }) => ({ data: await getAlertRule(ctx, params.project, params.rule) }))

export const PATCH = apiHandler<P>({ scope: 'write' }, async ({ ctx, params, request }) => {
  const input = await readJson(request, alertRuleUpdateInput)
  return { data: await updateAlertRule(ctx, params.project, params.rule, input) }
})

export const DELETE = apiHandler<P>({ scope: 'write' }, async ({ ctx, params }) => {
  await deleteAlertRule(ctx, params.project, params.rule)
})
