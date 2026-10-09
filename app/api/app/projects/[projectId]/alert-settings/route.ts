import { appHandler } from '@/lib/http/app'
import { readJson } from '@/lib/http/responses'
import { getAlertSettings, updateAlertSettings } from '@/lib/domain/alerts'
import { alertSettingsInput } from '@/lib/domain/schemas/alerts'

type P = { projectId: string }

export const GET = appHandler<P>(async ({ ctx, params }) => ({ data: await getAlertSettings(ctx, params.projectId) }))

export const PATCH = appHandler<P>(async ({ ctx, params, request }) => {
  const input = await readJson(request, alertSettingsInput)
  return { data: await updateAlertSettings(ctx, params.projectId, input) }
})
