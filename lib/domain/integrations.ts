import 'server-only'
import type { InboundIntegrationType, ProblemStatus } from '@shared/domain.ts'
import { env } from '@/lib/env'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import { invalidateStatusPage } from './cache'
import { actorUserId, type DomainContext } from './context'
import { DomainError, fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import { InboundParseError, isTrustedSnsUrl, mapAlertsToSignals, parseInboundPayload, type ComponentRef, type InboundPayload, type SignalInput } from './inbound'
import type { InboundResult, IntegrationCreateInput, IntegrationMappingResource, IntegrationResource, IntegrationUpdateInput, MappingInput } from './schemas/integrations'
import type { InboundIntegrationRow } from './types'

// Inbound integrations (spec §8): Alertmanager, Grafana, Datadog, CloudWatch and generic JSON alerts become component
// signals through ingest_signals(). Integration URLs contain a secret token, so only admins read and manage them
// (RLS inbound_integrations_select requires admin as well).

const INTEGRATION_COLUMNS =
  'id, project_id, type, name, token, enabled, mappings, default_component_id, default_status, auto_draft_incident, last_received_at, last_error, received_count, created_by, created_at, updated_at'

/** Integration tokens are 48 hex characters (gen_random_bytes(24)). */
export const INBOUND_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
export const MAX_INBOUND_BYTES = 1_000_000

export function inboundUrl(token: string): string {
  return `${env.appUrl()}/api/v1/inbound/${token}`
}

export function toIntegrationResource(row: InboundIntegrationRow, activeSignals = 0): IntegrationResource {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: row.enabled,
    url: inboundUrl(row.token),
    default_component_id: row.default_component_id,
    default_status: row.default_status,
    auto_draft_incident: row.auto_draft_incident,
    mappings: (Array.isArray(row.mappings) ? row.mappings : []).map(
      (mapping): IntegrationMappingResource => ({ match: mapping.match ?? {}, component_id: mapping.component_id, status: mapping.status ?? null }),
    ),
    last_received_at: row.last_received_at,
    received_count: Number(row.received_count ?? 0),
    last_error: row.last_error,
    active_signals: activeSignals,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function touchStatusPage(access: ProjectAccess): void {
  invalidateStatusPage(access.organization.slug, access.project.slug)
}

async function activeSignalCounts(ctx: DomainContext, integrationIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (integrationIds.length === 0) return counts
  const rows = unwrap(await ctx.db.from('component_signals').select('integration_id').eq('active', true).in('integration_id', integrationIds)) as Array<{ integration_id: string }>
  for (const row of rows) counts.set(row.integration_id, (counts.get(row.integration_id) ?? 0) + 1)
  return counts
}

async function resolveIntegration(ctx: DomainContext, projectId: string, ref: string): Promise<InboundIntegrationRow> {
  if (!isUuid(ref)) throw notFound('Integration')
  return unwrapOne(await ctx.db.from('inbound_integrations').select(INTEGRATION_COLUMNS).eq('project_id', projectId).eq('id', ref.toLowerCase()).maybeSingle(), 'Integration') as InboundIntegrationRow
}

async function readIntegration(ctx: DomainContext, projectId: string, id: string): Promise<IntegrationResource> {
  const row = await resolveIntegration(ctx, projectId, id)
  return toIntegrationResource(row, (await activeSignalCounts(ctx, [row.id])).get(row.id) ?? 0)
}

/** Resolves component refs (ids or keys) of the default component and the mappings to ids of this project. */
async function resolveComponentRefs(
  ctx: DomainContext,
  projectId: string,
  input: { default_component_id?: string | null; mappings?: MappingInput[] },
): Promise<{ defaultComponentId?: string | null; mappings?: Array<{ match: Record<string, string>; component_id: string; status?: ProblemStatus }> }> {
  const needed = input.default_component_id !== undefined || input.mappings !== undefined
  if (!needed) return {}
  const rows = unwrap(await ctx.db.from('components').select('id, slug').eq('project_id', projectId)) as ComponentRef[]
  const find = (ref: string) => rows.find((row) => row.id === ref.trim().toLowerCase() || row.slug === ref.trim().toLowerCase())
  const result: Awaited<ReturnType<typeof resolveComponentRefs>> = {}
  if (input.default_component_id !== undefined) {
    if (input.default_component_id === null) result.defaultComponentId = null
    else {
      const match = find(input.default_component_id)
      if (!match) throw invalid(`Component ${input.default_component_id} was not found in this status page.`, [{ path: 'default_component_id', message: 'This component does not exist.' }])
      result.defaultComponentId = match.id
    }
  }
  if (input.mappings !== undefined) {
    result.mappings = input.mappings.map((mapping, index) => {
      const match = find(mapping.component_id)
      if (!match) throw invalid(`Component ${mapping.component_id} was not found in this status page.`, [{ path: `mappings.${index}.component_id`, message: 'This component does not exist.' }])
      const labels = Object.fromEntries(Object.entries(mapping.match).map(([key, value]) => [key.trim(), value.trim()]))
      return mapping.status ? { match: labels, component_id: match.id, status: mapping.status } : { match: labels, component_id: match.id }
    })
  }
  return result
}

// ------------------------------------------------------------------ CRUD (admin)
export async function listIntegrations(ctx: DomainContext, projectRef: string): Promise<{ access: ProjectAccess; integrations: IntegrationResource[] }> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const rows = unwrap(await ctx.db.from('inbound_integrations').select(INTEGRATION_COLUMNS).eq('project_id', access.project.id).order('created_at')) as InboundIntegrationRow[]
  const counts = await activeSignalCounts(ctx, rows.map((row) => row.id))
  return { access, integrations: rows.map((row) => toIntegrationResource(row, counts.get(row.id) ?? 0)) }
}

export async function getIntegration(ctx: DomainContext, projectRef: string, integrationRef: string): Promise<IntegrationResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  return readIntegration(ctx, access.project.id, integrationRef)
}

export async function createIntegration(ctx: DomainContext, projectRef: string, input: IntegrationCreateInput): Promise<IntegrationResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const refs = await resolveComponentRefs(ctx, access.project.id, input)
  const { data, error } = await ctx.db
    .from('inbound_integrations')
    .insert({
      project_id: access.project.id,
      type: input.type,
      name: input.name,
      enabled: input.enabled ?? true,
      default_component_id: refs.defaultComponentId ?? null,
      ...(input.default_status ? { default_status: input.default_status } : {}),
      auto_draft_incident: input.auto_draft_incident ?? false,
      mappings: refs.mappings ?? [],
      created_by: actorUserId(ctx),
    })
    .select('id')
    .single()
  if (error) throw fromDatabaseError(error, 'Integration')
  const id = (data as { id: string }).id
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'integration.created', targetType: 'inbound_integration', targetId: id, metadata: { name: input.name, type: input.type } })
  return readIntegration(ctx, access.project.id, id)
}

export async function updateIntegration(ctx: DomainContext, projectRef: string, integrationRef: string, input: IntegrationUpdateInput): Promise<IntegrationResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await resolveIntegration(ctx, access.project.id, integrationRef)
  const refs = await resolveComponentRefs(ctx, access.project.id, input)
  const patch: Record<string, unknown> = {}
  if (input.type !== undefined) patch.type = input.type
  if (input.name !== undefined) patch.name = input.name
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.default_status !== undefined) patch.default_status = input.default_status
  if (input.auto_draft_incident !== undefined) patch.auto_draft_incident = input.auto_draft_incident
  if (refs.defaultComponentId !== undefined) patch.default_component_id = refs.defaultComponentId
  if (refs.mappings !== undefined) patch.mappings = refs.mappings
  if (Object.keys(patch).length === 0) return readIntegration(ctx, access.project.id, current.id)
  const { error } = await ctx.db.from('inbound_integrations').update(patch).eq('id', current.id).eq('project_id', access.project.id)
  if (error) throw fromDatabaseError(error, 'Integration')

  // A disabled integration stops counting: resolve what it had firing so components return to automatic status.
  if (input.enabled === false && current.enabled) await resolveActiveSignals(ctx, current.id)
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: input.enabled !== undefined && Object.keys(patch).length === 1 ? (input.enabled ? 'integration.enabled' : 'integration.disabled') : 'integration.updated',
    targetType: 'inbound_integration',
    targetId: current.id,
    metadata: { name: current.name, changes: Object.keys(patch) },
  })
  if (input.enabled === false) touchStatusPage(access)
  return readIntegration(ctx, access.project.id, current.id)
}

/** Marks every firing signal of an integration resolved (admin client: component_signals has no write policy). */
async function resolveActiveSignals(ctx: DomainContext, integrationId: string): Promise<void> {
  const { error } = await ctx
    .admin()
    .from('component_signals')
    .update({ active: false, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('integration_id', integrationId)
    .eq('active', true)
  if (error) console.error('[integrations] could not resolve signals', error.message)
}

export async function deleteIntegration(ctx: DomainContext, projectRef: string, integrationRef: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await resolveIntegration(ctx, access.project.id, integrationRef)
  const deleted = unwrap(await ctx.db.from('inbound_integrations').delete().eq('id', current.id).eq('project_id', access.project.id).select('id')) as Array<{ id: string }>
  if (deleted.length === 0) throw notFound('Integration')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'integration.deleted', targetType: 'inbound_integration', targetId: current.id, metadata: { name: current.name, type: current.type } })
  touchStatusPage(access)
}

// ------------------------------------------------------------------ inbound endpoint (token, no API key)
async function findIntegrationByToken(ctx: DomainContext, token: string): Promise<InboundIntegrationRow> {
  if (!INBOUND_TOKEN_PATTERN.test(token)) throw notFound('Integration')
  const { data, error } = await ctx.admin().from('inbound_integrations').select(INTEGRATION_COLUMNS).eq('token', token).maybeSingle()
  if (error) throw fromDatabaseError(error, 'Integration')
  const row = data as InboundIntegrationRow | null
  if (!row || !row.enabled) throw notFound('Integration')
  return row
}

async function recordInboundError(ctx: DomainContext, integrationId: string, message: string, received: boolean): Promise<void> {
  const patch: Record<string, unknown> = { last_error: message.slice(0, 500) }
  if (received) patch.last_received_at = new Date().toISOString()
  const { error } = await ctx.admin().from('inbound_integrations').update(patch).eq('id', integrationId)
  if (error) console.error('[integrations] could not record last_error', error.message)
}

const SNS_TIMEOUT_MS = 10_000

/** Opens the SubscribeURL of an SNS subscription confirmation (only on sns.<region>.amazonaws.com). */
async function confirmSnsSubscription(subscribeUrl: string, fetcher: typeof fetch): Promise<void> {
  if (!isTrustedSnsUrl(subscribeUrl)) {
    throw new InboundParseError('The SubscribeURL is not an Amazon SNS address (https://sns.<region>.amazonaws.com).')
  }
  let response: Response
  try {
    response = await fetcher(subscribeUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(SNS_TIMEOUT_MS), cache: 'no-store' })
  } catch {
    throw new DomainError('unavailable', 'Could not reach Amazon SNS to confirm the subscription. SNS retries on its own.')
  }
  if (!response.ok) throw new DomainError('unavailable', `Amazon SNS refused the subscription confirmation (HTTP ${response.status}).`)
}

export interface InboundRequest {
  /** Raw body (SNS sends JSON as text/plain). */
  body: string
}

/**
 * Receives a provider payload for the integration with this token: parses it, maps alerts to components and calls
 * ingest_signals(). Unknown or disabled tokens → 404. Unreadable payloads → 422 and integration.last_error.
 */
export async function receiveInboundAlerts(ctx: DomainContext, token: string, request: InboundRequest, fetcher: typeof fetch = fetch): Promise<InboundResult> {
  const integration = await findIntegrationByToken(ctx, token)
  const fail = async (message: string): Promise<never> => {
    await recordInboundError(ctx, integration.id, message, true)
    throw invalid(message)
  }

  if (request.body.length > MAX_INBOUND_BYTES) return fail('The payload is larger than 1 MB.')
  let body: unknown
  try {
    body = JSON.parse(request.body)
  } catch {
    return fail(request.body.trim() === '' ? 'The request has no body. Send the alert as JSON.' : 'The payload is not valid JSON.')
  }

  let payload: InboundPayload
  try {
    payload = parseInboundPayload(integration.type as InboundIntegrationType, body)
    if (payload.kind === 'subscription_confirmation') {
      await confirmSnsSubscription(payload.subscribeUrl, fetcher)
    }
  } catch (cause) {
    if (cause instanceof InboundParseError) return fail(cause.message)
    if (cause instanceof DomainError) {
      await recordInboundError(ctx, integration.id, cause.message, true)
      throw cause
    }
    throw cause
  }

  const admin = ctx.admin()
  if (payload.kind !== 'alerts') {
    // Subscription confirmations and unsubscribe notices count as received; nothing to ingest.
    const { error } = await admin.rpc('ingest_signals', { p_integration_id: integration.id, p_signals: [] })
    if (error) throw fromDatabaseError(error, 'Integration')
    return { upserted: 0, resolved: 0, unmatched: 0, ...(payload.kind === 'subscription_confirmation' ? { subscription_confirmed: true } : {}) }
  }

  const components = unwrap(await admin.from('components').select('id, slug').eq('project_id', integration.project_id)) as ComponentRef[]
  const { signals, unmatched } = mapAlertsToSignals(
    payload.alerts,
    { mappings: Array.isArray(integration.mappings) ? integration.mappings : [], default_component_id: integration.default_component_id, default_status: integration.default_status },
    components,
  )

  // A resolved alert also resolves what it set on other components (the mappings may have changed since it fired).
  const resolvedIds = [...new Set(payload.alerts.filter((alert) => !alert.active).map((alert) => alert.external_id))]
  let stillUnmatched = unmatched
  if (resolvedIds.length > 0) {
    const firing = unwrap(
      await admin.from('component_signals').select('external_id, component_id').eq('integration_id', integration.id).eq('active', true).in('external_id', resolvedIds.slice(0, 500)),
    ) as Array<{ external_id: string; component_id: string }>
    for (const row of firing) {
      if (signals.some((signal) => signal.external_id === row.external_id && signal.component_id === row.component_id)) continue
      signals.push({ external_id: row.external_id, component_id: row.component_id, status: integration.default_status, active: false, summary: null, labels: {} } satisfies SignalInput)
    }
    stillUnmatched = unmatched.filter((alert) => alert.active || !firing.some((row) => row.external_id === alert.external_id))
  }

  const { data, error } = await admin.rpc('ingest_signals', { p_integration_id: integration.id, p_signals: signals })
  if (error) throw fromDatabaseError(error, 'Integration')
  const result = (data ?? { upserted: 0, resolved: 0 }) as { upserted: number; resolved: number }

  const firingUnmatched = stillUnmatched.filter((alert) => alert.active)
  if (firingUnmatched.length > 0) {
    const names = firingUnmatched.slice(0, 3).map((alert) => alert.summary ?? alert.external_id).join(', ')
    await recordInboundError(
      ctx,
      integration.id,
      `${firingUnmatched.length} alert${firingUnmatched.length === 1 ? '' : 's'} matched no component (${names}). Add a mapping, a component label or a default component.`,
      false,
    )
  }
  return { upserted: result.upserted, resolved: result.resolved, unmatched: stillUnmatched.length }
}
