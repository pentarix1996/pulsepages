import 'server-only'
import { requireProject, isUuid, type ProjectAccess } from './access'
import { audit } from './audit'
import { invalidateStatusPage } from './cache'
import type { DomainContext } from './context'
import { fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import type {
  ComponentCreateInput,
  ComponentGroupResource,
  ComponentResource,
  ComponentUpdateInput,
  DependenciesInput,
  GroupCreateInput,
  GroupUpdateInput,
  ReorderInput,
} from './schemas/components'
import type { ComponentDependencyRow, ComponentGroupRow, ComponentRow } from './types'
import type { ComponentStatus } from '@shared/domain.ts'

const COMPONENT_COLUMNS =
  'id, project_id, name, slug, description, group_id, position, status, status_source, status_changed_at, manual_status, manual_status_set_by, manual_status_set_at, automated_status, automated_source, created_at, updated_at'

export function toComponentResource(row: ComponentRow, dependencies: ComponentDependencyRow[] = []): ComponentResource {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    status_source: row.status_source,
    manual_status: row.manual_status,
    automated_status: row.automated_status,
    group_id: row.group_id,
    position: row.position,
    depends_on: dependencies.filter((dep) => dep.component_id === row.id).map((dep) => ({ component_id: dep.depends_on_id, impact: dep.impact })),
    status_changed_at: row.status_changed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function toGroupResource(row: ComponentGroupRow): ComponentGroupResource {
  return { id: row.id, name: row.name, position: row.position, collapsed: row.collapsed, created_at: row.created_at, updated_at: row.updated_at }
}

function touchStatusPage(access: ProjectAccess): void {
  invalidateStatusPage(access.organization.slug, access.project.slug)
}

async function loadDependencies(ctx: DomainContext, componentIds: string[]): Promise<ComponentDependencyRow[]> {
  if (componentIds.length === 0) return []
  return unwrap(await ctx.db.from('component_dependencies').select('*').in('component_id', componentIds)) as ComponentDependencyRow[]
}

/** Finds a component of the project by id or key (slug). */
export async function resolveComponent(ctx: DomainContext, projectId: string, ref: string): Promise<ComponentRow> {
  let query = ctx.db.from('components').select(COMPONENT_COLUMNS).eq('project_id', projectId)
  query = isUuid(ref) ? query.eq('id', ref) : query.eq('slug', ref.toLowerCase())
  return unwrapOne(await query.maybeSingle(), 'Component') as ComponentRow
}

async function resolveComponentIds(ctx: DomainContext, projectId: string, refs: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(refs.map((ref) => ref.trim()))]
  if (unique.length === 0) return new Map()
  const rows = unwrap(await ctx.db.from('components').select('id, slug').eq('project_id', projectId)) as Array<{ id: string; slug: string }>
  const map = new Map<string, string>()
  for (const ref of unique) {
    const match = rows.find((row) => row.id === ref || row.slug === ref.toLowerCase())
    if (!match) throw invalid(`Component ${ref} was not found in this status page.`)
    map.set(ref, match.id)
  }
  return map
}

export async function listComponents(ctx: DomainContext, projectRef: string): Promise<{ access: ProjectAccess; components: ComponentResource[]; groups: ComponentGroupResource[] }> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const [components, groups] = await Promise.all([
    ctx.db.from('components').select(COMPONENT_COLUMNS).eq('project_id', access.project.id).order('position').order('name'),
    ctx.db.from('component_groups').select('*').eq('project_id', access.project.id).order('position').order('name'),
  ])
  const rows = unwrap(components) as ComponentRow[]
  const dependencies = await loadDependencies(ctx, rows.map((row) => row.id))
  return {
    access,
    components: rows.map((row) => toComponentResource(row, dependencies)),
    groups: (unwrap(groups) as ComponentGroupRow[]).map(toGroupResource),
  }
}

export async function getComponent(ctx: DomainContext, projectRef: string, componentRef: string): Promise<ComponentResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const row = await resolveComponent(ctx, access.project.id, componentRef)
  return toComponentResource(row, await loadDependencies(ctx, [row.id]))
}

async function nextPosition(ctx: DomainContext, projectId: string, groupId: string | null): Promise<number> {
  let query = ctx.db.from('components').select('position').eq('project_id', projectId).order('position', { ascending: false }).limit(1)
  query = groupId ? query.eq('group_id', groupId) : query.is('group_id', null)
  const rows = unwrap(await query) as Array<{ position: number }>
  return rows.length > 0 ? rows[0]!.position + 1 : 0
}

async function replaceDependencies(ctx: DomainContext, projectId: string, componentId: string, input: DependenciesInput['depends_on']): Promise<void> {
  const ids = await resolveComponentIds(ctx, projectId, input.map((dep) => dep.component))
  const desired = new Map<string, ComponentDependencyRow['impact']>()
  for (const dep of input) {
    const target = ids.get(dep.component.trim())!
    if (target === componentId) throw invalid('A component cannot depend on itself.')
    desired.set(target, dep.impact)
  }
  const current = unwrap(await ctx.db.from('component_dependencies').select('*').eq('component_id', componentId)) as ComponentDependencyRow[]
  const removed = current.filter((dep) => !desired.has(dep.depends_on_id)).map((dep) => dep.depends_on_id)
  if (removed.length > 0) {
    unwrap(await ctx.db.from('component_dependencies').delete().eq('component_id', componentId).in('depends_on_id', removed))
  }
  const upserts = [...desired.entries()]
    .filter(([target, impact]) => current.find((dep) => dep.depends_on_id === target)?.impact !== impact)
    .map(([target, impact]) => ({ component_id: componentId, depends_on_id: target, impact }))
  if (upserts.length > 0) {
    unwrap(await ctx.db.from('component_dependencies').upsert(upserts, { onConflict: 'component_id,depends_on_id' }))
  }
}

/** Legacy `status` on create/update: operational clears the pin, anything else pins it. */
function legacyStatusToPin(status: ComponentStatus | undefined): { manual_status?: ComponentStatus | null } {
  if (status === undefined) return {}
  return { manual_status: status === 'operational' ? null : status }
}

export async function createComponent(ctx: DomainContext, projectRef: string, input: ComponentCreateInput): Promise<ComponentResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const groupId = input.group_id ?? null
  const position = input.position ?? (await nextPosition(ctx, access.project.id, groupId))
  const insert = await ctx.db
    .from('components')
    .insert({
      project_id: access.project.id,
      name: input.name,
      slug: input.slug ?? null,
      description: input.description ?? null,
      group_id: groupId,
      position,
      ...legacyStatusToPin(input.status),
    })
    .select(COMPONENT_COLUMNS)
    .single()
  const row = unwrapOne(insert, 'Component') as ComponentRow
  if (input.depends_on && input.depends_on.length > 0) {
    try {
      await replaceDependencies(ctx, access.project.id, row.id, input.depends_on)
    } catch (error) {
      await ctx.db.from('components').delete().eq('id', row.id)
      throw error
    }
  }
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'component.created', targetType: 'component', targetId: row.id, metadata: { name: row.name, slug: row.slug } })
  touchStatusPage(access)
  return getComponent(ctx, access.project.id, row.id)
}

export async function updateComponent(ctx: DomainContext, projectRef: string, componentRef: string, input: ComponentUpdateInput): Promise<ComponentResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await resolveComponent(ctx, access.project.id, componentRef)
  const patch: Record<string, unknown> = { ...legacyStatusToPin(input.status) }
  if (input.name !== undefined) patch.name = input.name
  if (input.slug !== undefined) patch.slug = input.slug
  if (input.description !== undefined) patch.description = input.description
  if (input.group_id !== undefined) patch.group_id = input.group_id
  if (input.position !== undefined) patch.position = input.position
  if (Object.keys(patch).length === 0) return toComponentResource(current, await loadDependencies(ctx, [current.id]))
  unwrap(await ctx.db.from('components').update(patch).eq('id', current.id).eq('project_id', access.project.id))
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'component.updated', targetType: 'component', targetId: current.id, metadata: { changes: Object.keys(patch) } })
  touchStatusPage(access)
  return getComponent(ctx, access.project.id, current.id)
}

export async function deleteComponent(ctx: DomainContext, projectRef: string, componentRef: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await resolveComponent(ctx, access.project.id, componentRef)
  unwrap(await ctx.db.from('components').delete().eq('id', current.id).eq('project_id', access.project.id))
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'component.deleted', targetType: 'component', targetId: current.id, metadata: { name: current.name, slug: current.slug } })
  touchStatusPage(access)
}

/** Pins a status (responder and up), or returns the component to automatic status with null. */
export async function setComponentManualStatus(ctx: DomainContext, projectRef: string, componentRef: string, status: ComponentStatus | null): Promise<ComponentResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await resolveComponent(ctx, access.project.id, componentRef)
  const { error } = await ctx.db.rpc('set_component_manual_status', { p_component_id: current.id, p_status: status })
  if (error) throw fromDatabaseError(error, 'Component')
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: status === null ? 'component.status_unpinned' : 'component.status_pinned',
    targetType: 'component',
    targetId: current.id,
    metadata: { status, previous: current.manual_status },
  })
  touchStatusPage(access)
  return getComponent(ctx, access.project.id, current.id)
}

export async function setComponentDependencies(ctx: DomainContext, projectRef: string, componentRef: string, input: DependenciesInput): Promise<ComponentResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await resolveComponent(ctx, access.project.id, componentRef)
  await replaceDependencies(ctx, access.project.id, current.id, input.depends_on)
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'component.dependencies_updated', targetType: 'component', targetId: current.id, metadata: { count: input.depends_on.length } })
  touchStatusPage(access)
  return getComponent(ctx, access.project.id, current.id)
}

export async function reorderComponents(ctx: DomainContext, projectRef: string, input: ReorderInput): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const projectId = access.project.id
  const known = new Set((unwrap(await ctx.db.from('components').select('id').eq('project_id', projectId)) as Array<{ id: string }>).map((row) => row.id))
  const knownGroups = new Set((unwrap(await ctx.db.from('component_groups').select('id').eq('project_id', projectId)) as Array<{ id: string }>).map((row) => row.id))
  for (const item of input.components) {
    if (!known.has(item.id)) throw notFound('Component')
    if (item.group_id && !knownGroups.has(item.group_id)) throw notFound('Group')
  }
  for (const group of input.groups) {
    if (!knownGroups.has(group.id)) throw notFound('Group')
    unwrap(await ctx.db.from('component_groups').update({ position: group.position }).eq('id', group.id).eq('project_id', projectId))
  }
  for (const item of input.components) {
    unwrap(await ctx.db.from('components').update({ group_id: item.group_id, position: item.position }).eq('id', item.id).eq('project_id', projectId))
  }
  await audit(ctx, { organizationId: access.organization.id, projectId, action: 'component.reordered', targetType: 'project', targetId: projectId })
  touchStatusPage(access)
}

// ------------------------------------------------------------------ groups
export async function listComponentGroups(ctx: DomainContext, projectRef: string): Promise<ComponentGroupResource[]> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const rows = unwrap(await ctx.db.from('component_groups').select('*').eq('project_id', access.project.id).order('position').order('name')) as ComponentGroupRow[]
  return rows.map(toGroupResource)
}

export async function createComponentGroup(ctx: DomainContext, projectRef: string, input: GroupCreateInput): Promise<ComponentGroupResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  let position = input.position
  if (position === undefined) {
    const last = unwrap(await ctx.db.from('component_groups').select('position').eq('project_id', access.project.id).order('position', { ascending: false }).limit(1)) as Array<{ position: number }>
    position = last.length > 0 ? last[0]!.position + 1 : 0
  }
  const row = unwrapOne(
    await ctx.db.from('component_groups').insert({ project_id: access.project.id, name: input.name, position, collapsed: input.collapsed ?? false }).select('*').single(),
    'Group',
  ) as ComponentGroupRow
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'component_group.created', targetType: 'component_group', targetId: row.id, metadata: { name: row.name } })
  touchStatusPage(access)
  return toGroupResource(row)
}

export async function updateComponentGroup(ctx: DomainContext, projectRef: string, groupId: string, input: GroupUpdateInput): Promise<ComponentGroupResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  if (!isUuid(groupId)) throw notFound('Group')
  const row = unwrapOne(
    await ctx.db.from('component_groups').update(input).eq('id', groupId).eq('project_id', access.project.id).select('*').maybeSingle(),
    'Group',
  ) as ComponentGroupRow
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'component_group.updated', targetType: 'component_group', targetId: row.id, metadata: { changes: Object.keys(input) } })
  touchStatusPage(access)
  return toGroupResource(row)
}

/** Deleting a group keeps its components (they become ungrouped). */
export async function deleteComponentGroup(ctx: DomainContext, projectRef: string, groupId: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  if (!isUuid(groupId)) throw notFound('Group')
  const deleted = unwrap(await ctx.db.from('component_groups').delete().eq('id', groupId).eq('project_id', access.project.id).select('id')) as Array<{ id: string }>
  if (deleted.length === 0) throw notFound('Group')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'component_group.deleted', targetType: 'component_group', targetId: groupId })
  touchStatusPage(access)
}
