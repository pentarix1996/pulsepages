import 'server-only'
import type { MaintenanceStatus } from '@shared/domain.ts'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import { actorLabel, type DomainContext } from './context'
import { conflict, fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import { loadComponentIndex, loadProfileNames, resolveComponentIds, statusPageLink, toActor, touchStatusPage, type ComponentIndexEntry } from './incidents'
import { keysetFilter, toPage, type Cursor, type Page, type PageRequest } from './pagination'
import type {
  MaintenanceActionInput,
  MaintenanceCreateInput,
  MaintenanceListFilter,
  MaintenancePatchInput,
  MaintenanceResource,
  MaintenanceUpdateInput,
  MaintenanceUpdateResource,
} from './schemas/maintenances'
import type { MaintenanceRow, MaintenanceUpdateRow } from './types'

type MaintenanceComponent = MaintenanceResource['components'][number]

export const CLOSED_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = ['completed', 'cancelled']

export function isMaintenanceClosed(status: MaintenanceStatus): boolean {
  return CLOSED_MAINTENANCE_STATUSES.includes(status)
}

export function toMaintenanceUpdateResource(row: MaintenanceUpdateRow, names: Map<string, string>): MaintenanceUpdateResource {
  return { id: row.id, status: row.status, message: row.message, actor: toActor(row.created_by, row.actor_label, names), created_at: row.created_at }
}

export function toMaintenanceResource(row: MaintenanceRow, access: ProjectAccess, components: MaintenanceComponent[], updates?: MaintenanceUpdateResource[]): MaintenanceResource {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    scheduled_start: row.scheduled_start,
    scheduled_end: row.scheduled_end,
    actual_start: row.actual_start,
    actual_end: row.actual_end,
    components,
    auto_start: row.auto_start,
    auto_complete: row.auto_complete,
    notify_subscribers: row.notify_subscribers,
    reminder_minutes: row.reminder_minutes,
    mute_alerts: row.mute_alerts,
    url: statusPageLink(access, `/maintenance/${row.id}`),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(updates ? { updates } : {}),
  }
}

async function loadComponents(ctx: DomainContext, maintenanceIds: string[]): Promise<Map<string, MaintenanceComponent[]>> {
  const map = new Map<string, MaintenanceComponent[]>()
  if (maintenanceIds.length === 0) return map
  type Link = { maintenance_id: string; component_id: string; component: { slug: string; name: string; position: number } | null }
  const links = (unwrap(
    await ctx.db.from('maintenance_components').select('maintenance_id, component_id, component:components(slug, name, position)').in('maintenance_id', maintenanceIds),
  ) as unknown as Link[])
    .filter((link) => link.component)
    .sort((a, b) => a.component!.position - b.component!.position || a.component!.name.localeCompare(b.component!.name))
  for (const link of links) {
    const list = map.get(link.maintenance_id) ?? []
    list.push({ component_id: link.component_id, slug: link.component!.slug, name: link.component!.name })
    map.set(link.maintenance_id, list)
  }
  return map
}

async function loadMaintenanceRow(ctx: DomainContext, projectId: string, maintenanceId: string): Promise<MaintenanceRow> {
  if (!isUuid(maintenanceId)) throw notFound('Maintenance window')
  return unwrapOne(await ctx.db.from('maintenances').select('*').eq('id', maintenanceId).eq('project_id', projectId).maybeSingle(), 'Maintenance window') as MaintenanceRow
}

async function maintenanceResource(ctx: DomainContext, access: ProjectAccess, row: MaintenanceRow, withUpdates: boolean): Promise<MaintenanceResource> {
  const components = (await loadComponents(ctx, [row.id])).get(row.id) ?? []
  if (!withUpdates) return toMaintenanceResource(row, access, components)
  const updates = unwrap(
    await ctx.db.from('maintenance_updates').select('*').eq('maintenance_id', row.id).order('created_at', { ascending: false }).order('id', { ascending: false }),
  ) as MaintenanceUpdateRow[]
  const names = await loadProfileNames(ctx, updates.map((update) => update.created_by))
  return toMaintenanceResource(row, access, components, updates.map((update) => toMaintenanceUpdateResource(update, names)))
}

/** PostgREST `or` filter for keyset pagination in ascending order (the shared helper is descending). */
function keysetFilterAscending(column: string, cursor: Cursor): string {
  const at = cursor.at.replace(/"/g, '')
  const id = cursor.id.replace(/[^0-9a-f-]/gi, '')
  return `${column}.gt."${at}",and(${column}.eq."${at}",id.gt.${id})`
}

/** Upcoming and active windows read soonest first; past and all read newest first. */
export function maintenanceListOrder(filter: MaintenanceListFilter): 'asc' | 'desc' {
  return filter === 'upcoming' || filter === 'active' ? 'asc' : 'desc'
}

export async function listMaintenances(ctx: DomainContext, projectRef: string, filter: MaintenanceListFilter, page: PageRequest): Promise<{ access: ProjectAccess; page: Page<MaintenanceResource> }> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const ascending = maintenanceListOrder(filter) === 'asc'
  let query = ctx.db.from('maintenances').select('*').eq('project_id', access.project.id)
  if (filter === 'upcoming') query = query.eq('status', 'scheduled')
  else if (filter === 'active') query = query.eq('status', 'in_progress')
  else if (filter === 'past') query = query.in('status', [...CLOSED_MAINTENANCE_STATUSES])
  if (page.cursor) query = query.or(ascending ? keysetFilterAscending('scheduled_start', page.cursor) : keysetFilter('scheduled_start', page.cursor))
  const rows = unwrap(await query.order('scheduled_start', { ascending }).order('id', { ascending }).limit(page.limit + 1)) as MaintenanceRow[]
  const { items, nextCursor } = toPage(rows, page, (row) => row.scheduled_start)
  const components = await loadComponents(ctx, items.map((row) => row.id))
  return { access, page: { items: items.map((row) => toMaintenanceResource(row, access, components.get(row.id) ?? [])), nextCursor } }
}

export async function getMaintenance(ctx: DomainContext, projectRef: string, maintenanceId: string): Promise<MaintenanceResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return maintenanceResource(ctx, access, await loadMaintenanceRow(ctx, access.project.id, maintenanceId), true)
}

/** Everything the maintenance page needs: the window with its updates and the project's components. */
export async function getMaintenanceView(ctx: DomainContext, projectRef: string, maintenanceId: string): Promise<{ access: ProjectAccess; maintenance: MaintenanceResource; components: ComponentIndexEntry[] }> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const row = await loadMaintenanceRow(ctx, access.project.id, maintenanceId)
  const [maintenance, components] = await Promise.all([maintenanceResource(ctx, access, row, true), loadComponentIndex(ctx, access.project.id)])
  return { access, maintenance, components }
}

export async function createMaintenance(ctx: DomainContext, projectRef: string, input: MaintenanceCreateInput): Promise<MaintenanceResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const componentIds = input.components.length > 0 ? resolveComponentIds(await loadComponentIndex(ctx, access.project.id), input.components) : []
  const { data, error } = await ctx.db.rpc('create_maintenance', {
    p_project_id: access.project.id,
    p_title: input.title,
    p_description: input.description,
    p_scheduled_start: input.scheduled_start,
    p_scheduled_end: input.scheduled_end,
    p_component_ids: componentIds,
    p_auto_start: input.auto_start,
    p_auto_complete: input.auto_complete,
    p_notify_subscribers: input.notify_subscribers,
    p_reminder_minutes: input.reminder_minutes,
    p_mute_alerts: input.mute_alerts,
    p_actor_label: actorLabel(ctx),
  })
  if (error) throw fromDatabaseError(error, 'Maintenance window')
  const row = data as MaintenanceRow
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'maintenance.created',
    targetType: 'maintenance',
    targetId: row.id,
    metadata: { title: row.title, status: row.status, scheduled_start: row.scheduled_start, scheduled_end: row.scheduled_end, components: componentIds.length },
  })
  touchStatusPage(access)
  return maintenanceResource(ctx, access, row, true)
}

export async function updateMaintenance(ctx: DomainContext, projectRef: string, maintenanceId: string, input: MaintenancePatchInput): Promise<MaintenanceResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadMaintenanceRow(ctx, access.project.id, maintenanceId)
  if (isMaintenanceClosed(current.status)) throw conflict('This maintenance window is already closed.')
  const start = input.scheduled_start ?? current.scheduled_start
  const end = input.scheduled_end ?? current.scheduled_end
  if (Date.parse(end) <= Date.parse(start)) {
    throw invalid('The window must end after it starts.', [{ path: 'scheduled_end', message: 'The window must end after it starts.' }])
  }
  const componentIds = input.components === undefined ? null : resolveComponentIds(await loadComponentIndex(ctx, access.project.id), input.components)
  const changes = Object.keys(input).filter((key) => input[key as keyof MaintenancePatchInput] !== undefined)
  if (changes.length === 0) return maintenanceResource(ctx, access, current, true)
  const { data, error } = await ctx.db.rpc('update_maintenance', {
    p_maintenance_id: current.id,
    p_title: input.title ?? null,
    p_description: input.description ?? null,
    p_scheduled_start: input.scheduled_start ?? null,
    p_scheduled_end: input.scheduled_end ?? null,
    p_component_ids: componentIds,
    p_auto_start: input.auto_start ?? null,
    p_auto_complete: input.auto_complete ?? null,
    p_notify_subscribers: input.notify_subscribers ?? null,
    p_reminder_minutes: input.reminder_minutes ?? null,
    p_mute_alerts: input.mute_alerts ?? null,
  })
  if (error) throw fromDatabaseError(error, 'Maintenance window')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'maintenance.updated', targetType: 'maintenance', targetId: current.id, metadata: { changes } })
  touchStatusPage(access)
  return maintenanceResource(ctx, access, data as MaintenanceRow, true)
}

type MaintenanceTarget = 'in_progress' | 'completed' | 'cancelled'

const TARGET_ACTIONS: Record<MaintenanceTarget, string> = {
  in_progress: 'maintenance.started',
  completed: 'maintenance.completed',
  cancelled: 'maintenance.cancelled',
}

/** Allowed moves: scheduled → in progress → completed, and scheduled or in progress → cancelled. Repeats are no-ops. */
export function checkMaintenanceTransition(from: MaintenanceStatus, to: MaintenanceTarget): 'apply' | 'noop' {
  if (from === to) return 'noop'
  if (isMaintenanceClosed(from)) throw conflict('This maintenance window is already closed.')
  if (to === 'completed' && from === 'scheduled') throw conflict('Start the maintenance before completing it, or cancel it.')
  return 'apply'
}

export async function setMaintenanceStatus(ctx: DomainContext, projectRef: string, maintenanceId: string, target: MaintenanceTarget, input: MaintenanceActionInput = {}): Promise<MaintenanceResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadMaintenanceRow(ctx, access.project.id, maintenanceId)
  if (checkMaintenanceTransition(current.status, target) === 'noop') return maintenanceResource(ctx, access, current, true)
  const { data, error } = await ctx.db.rpc('set_maintenance_status', {
    p_maintenance_id: current.id,
    p_status: target,
    p_message: input.message?.trim() || null,
    p_actor_label: actorLabel(ctx),
  })
  if (error) throw fromDatabaseError(error, 'Maintenance window')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: TARGET_ACTIONS[target], targetType: 'maintenance', targetId: current.id, metadata: { title: current.title, previous_status: current.status } })
  touchStatusPage(access)
  return maintenanceResource(ctx, access, data as MaintenanceRow, true)
}

export const startMaintenance = (ctx: DomainContext, projectRef: string, maintenanceId: string, input?: MaintenanceActionInput) => setMaintenanceStatus(ctx, projectRef, maintenanceId, 'in_progress', input)
export const completeMaintenance = (ctx: DomainContext, projectRef: string, maintenanceId: string, input?: MaintenanceActionInput) => setMaintenanceStatus(ctx, projectRef, maintenanceId, 'completed', input)
export const cancelMaintenance = (ctx: DomainContext, projectRef: string, maintenanceId: string, input?: MaintenanceActionInput) => setMaintenanceStatus(ctx, projectRef, maintenanceId, 'cancelled', input)

export async function postMaintenanceUpdate(ctx: DomainContext, projectRef: string, maintenanceId: string, input: MaintenanceUpdateInput): Promise<MaintenanceUpdateResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadMaintenanceRow(ctx, access.project.id, maintenanceId)
  const { data, error } = await ctx.db.rpc('post_maintenance_update', { p_maintenance_id: current.id, p_message: input.message, p_actor_label: actorLabel(ctx) })
  if (error) throw fromDatabaseError(error, 'Maintenance window')
  const row = data as MaintenanceUpdateRow
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'maintenance.update_posted', targetType: 'maintenance', targetId: current.id, metadata: { update_id: row.id } })
  touchStatusPage(access)
  return toMaintenanceUpdateResource(row, await loadProfileNames(ctx, [row.created_by]))
}
