import 'server-only'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import type { DomainContext } from './context'
import { fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import type { SloCreateInput, SloResource, SloUpdateInput } from './schemas/metrics'
import type { ProjectMetrics, SloRow } from './types'

const SLO_COLUMNS = 'id, project_id, component_id, name, target, window_days, created_at, updated_at'

export type SloStatus = ProjectMetrics['slos'][number]

export function toSloResource(row: SloRow, status: SloStatus | undefined): SloResource {
  return {
    id: row.id,
    name: row.name,
    target: Number(row.target),
    window_days: row.window_days,
    component_id: row.component_id,
    actual: status ? Number(status.actual) : null,
    budget_remaining: status ? Number(status.budget_remaining) : null,
    allowed_downtime_seconds: status ? Number(status.allowed_downtime_seconds) : null,
    consumed_downtime_seconds: status ? Number(status.consumed_downtime_seconds) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Live error budget of every SLO of the page (rolling windows ending now). */
export async function sloStatuses(ctx: DomainContext, projectId: string): Promise<SloStatus[]> {
  const { data, error } = await ctx.db.rpc('get_project_slos', { p_project_id: projectId })
  if (error) throw fromDatabaseError(error, 'Status page')
  return (data ?? []) as SloStatus[]
}

async function resolveComponentId(ctx: DomainContext, projectId: string, ref: string | null | undefined): Promise<string | null | undefined> {
  if (ref === undefined) return undefined
  if (ref === null) return null
  let query = ctx.db.from('components').select('id').eq('project_id', projectId)
  query = isUuid(ref) ? query.eq('id', ref) : query.eq('slug', ref.toLowerCase())
  const row = unwrap(await query.maybeSingle()) as { id: string } | null
  if (!row) throw invalid(`Component ${ref} was not found in this status page.`, [{ path: 'component_id', message: 'Choose a component of this status page.' }])
  return row.id
}

async function loadSlo(ctx: DomainContext, access: ProjectAccess, sloId: string): Promise<SloRow> {
  if (!isUuid(sloId)) throw notFound('SLO')
  return unwrapOne(await ctx.db.from('slos').select(SLO_COLUMNS).eq('id', sloId).eq('project_id', access.project.id).maybeSingle(), 'SLO') as SloRow
}

async function withStatus(ctx: DomainContext, access: ProjectAccess, row: SloRow): Promise<SloResource> {
  const statuses = await sloStatuses(ctx, access.project.id)
  return toSloResource(row, statuses.find((status) => status.id === row.id))
}

export async function listSlos(ctx: DomainContext, projectRef: string): Promise<SloResource[]> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const [rows, statuses] = await Promise.all([
    ctx.db.from('slos').select(SLO_COLUMNS).eq('project_id', access.project.id).order('name').order('id'),
    sloStatuses(ctx, access.project.id),
  ])
  return (unwrap(rows) as SloRow[]).map((row) => toSloResource(row, statuses.find((status) => status.id === row.id)))
}

export async function getSlo(ctx: DomainContext, projectRef: string, sloId: string): Promise<SloResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return withStatus(ctx, access, await loadSlo(ctx, access, sloId))
}

export async function createSlo(ctx: DomainContext, projectRef: string, input: SloCreateInput): Promise<SloResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const componentId = await resolveComponentId(ctx, access.project.id, input.component_id)
  const row = unwrapOne(
    await ctx.db
      .from('slos')
      .insert({ project_id: access.project.id, component_id: componentId ?? null, name: input.name, target: input.target, window_days: input.window_days })
      .select(SLO_COLUMNS)
      .single(),
    'SLO',
  ) as SloRow
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'slo.created',
    targetType: 'slo',
    targetId: row.id,
    metadata: { name: row.name, target: Number(row.target), window_days: row.window_days, component_id: row.component_id },
  })
  return withStatus(ctx, access, row)
}

export async function updateSlo(ctx: DomainContext, projectRef: string, sloId: string, input: SloUpdateInput): Promise<SloResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await loadSlo(ctx, access, sloId)
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.target !== undefined) patch.target = input.target
  if (input.window_days !== undefined) patch.window_days = input.window_days
  if (input.component_id !== undefined) patch.component_id = await resolveComponentId(ctx, access.project.id, input.component_id)
  if (Object.keys(patch).length === 0) return withStatus(ctx, access, current)
  const row = unwrapOne(
    await ctx.db.from('slos').update(patch).eq('id', current.id).eq('project_id', access.project.id).select(SLO_COLUMNS).maybeSingle(),
    'SLO',
  ) as SloRow
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'slo.updated', targetType: 'slo', targetId: row.id, metadata: { changes: Object.keys(patch) } })
  return withStatus(ctx, access, row)
}

export async function deleteSlo(ctx: DomainContext, projectRef: string, sloId: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await loadSlo(ctx, access, sloId)
  const deleted = unwrap(await ctx.db.from('slos').delete().eq('id', current.id).eq('project_id', access.project.id).select('id')) as Array<{ id: string }>
  if (deleted.length === 0) throw notFound('SLO')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'slo.deleted', targetType: 'slo', targetId: current.id, metadata: { name: current.name } })
}
