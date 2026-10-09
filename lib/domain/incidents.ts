import 'server-only'
import { statusPageUrl } from '@shared/alerts/message.ts'
import {
  ACTIVE_INCIDENT_STATUSES,
  IMPACT_TO_SEVERITY,
  SEVERITY_TO_COMPONENT_STATUS,
  SEVERITY_TO_IMPACT,
  type ComponentStatus,
  type IncidentImpact,
  type IncidentSource,
  type IncidentStatus,
} from '@shared/domain.ts'
import { env } from '@/lib/env'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import { invalidateStatusPage } from './cache'
import { actorLabel, type DomainContext } from './context'
import { conflict, fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import { keysetFilter, toPage, type Page, type PageRequest } from './pagination'
import type {
  ActorResource,
  IncidentComponentResource,
  IncidentCreateInput,
  IncidentLegacyUpdateInput,
  IncidentListFilter,
  IncidentPatchInput,
  IncidentPublishInput,
  IncidentResource,
  IncidentUpdateInput,
  IncidentUpdateResource,
  LegacySeverity,
  PublicIncidentStatus,
  TemplateStatus,
} from './schemas/incidents'
import type { IncidentRow, IncidentUpdateRow } from './types'

// ------------------------------------------------------------------ shared helpers (also used by maintenances,
// postmortems and incident templates)

const INCIDENT_COLUMNS =
  'id, project_id, title, description, status, impact, severity, component_ids, detected_at, acknowledged_at, acknowledged_by, published_at, resolved_at, created_by, source, source_monitor_id, deleted_at, created_at, updated_at'

/** Message used for a public update when the person or API client did not write one. */
export const DEFAULT_INCIDENT_MESSAGES: Record<PublicIncidentStatus, string> = {
  investigating: 'We are investigating this issue.',
  identified: 'We identified the cause and are working on a fix.',
  monitoring: 'A fix is in place and we are monitoring the results.',
  resolved: 'This incident has been resolved.',
}

export function touchStatusPage(access: ProjectAccess): void {
  invalidateStatusPage(access.organization.slug, access.project.slug)
}

/** Public URL of a page under the project's status page (verified custom domain first). */
export function statusPageLink(access: ProjectAccess, subPath = ''): string {
  return statusPageUrl(
    {
      organization_slug: access.organization.slug,
      slug: access.project.slug,
      custom_domain: access.project.custom_domain_status === 'verified' ? access.project.custom_domain : null,
    },
    { appUrl: env.appUrl() },
    subPath,
  )
}

/** Who wrote a row: a person (by id), an API key or integration (by label), or Upvane itself. */
export function toActor(createdBy: string | null, label: string | null, names: Map<string, string>): ActorResource {
  if (createdBy) return { type: 'user', label: names.get(createdBy) ?? 'A team member' }
  if (label) return { type: label.startsWith('API key ') ? 'api_key' : 'system', label }
  return { type: 'system', label: 'Upvane' }
}

/** Display names of profiles the actor can read (fellow members for users, anyone for API keys). */
export async function loadProfileNames(ctx: DomainContext, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  const names = new Map<string, string>()
  if (unique.length === 0) return names
  const rows = unwrap(await ctx.db.from('profiles').select('id, name, username').in('id', unique)) as Array<{ id: string; name: string | null; username: string | null }>
  for (const row of rows) names.set(row.id, row.name?.trim() || row.username || 'A team member')
  return names
}

export interface ComponentIndexEntry {
  id: string
  slug: string
  name: string
  status: ComponentStatus
  position: number
  group_id: string | null
}

/** Components of a project, in status page order, for resolving `id or key` references. */
export async function loadComponentIndex(ctx: DomainContext, projectId: string): Promise<ComponentIndexEntry[]> {
  return unwrap(
    await ctx.db.from('components').select('id, slug, name, status, position, group_id').eq('project_id', projectId).order('position').order('name'),
  ) as ComponentIndexEntry[]
}

export function findComponent(index: ComponentIndexEntry[], ref: string): ComponentIndexEntry | undefined {
  const value = ref.trim()
  return index.find((component) => component.id === value) ?? index.find((component) => component.slug === value.toLowerCase())
}

export function componentNotFound(ref: string) {
  return invalid(`Component ${ref} was not found in this status page.`, [{ path: 'components', message: `Unknown component ${ref}.` }])
}

/** Maps `{ "<id|key>": value }` to `{ "<component id>": value }`, rejecting unknown components. */
export function resolveComponentMap<T>(index: ComponentIndexEntry[], map: Record<string, T>): Record<string, T> {
  const resolved: Record<string, T> = {}
  for (const [ref, value] of Object.entries(map)) {
    const component = findComponent(index, ref)
    if (!component) throw componentNotFound(ref)
    resolved[component.id] = value
  }
  return resolved
}

export function resolveComponentIds(index: ComponentIndexEntry[], refs: string[]): string[] {
  const ids: string[] = []
  for (const ref of refs) {
    const component = findComponent(index, ref)
    if (!component) throw componentNotFound(ref)
    if (!ids.includes(component.id)) ids.push(component.id)
  }
  return ids
}

// ------------------------------------------------------------------ v0 compatibility and create planning

function filled(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** v0: the component status a severity implied (component_ids carried no status of their own). */
export function legacyComponentStatus(severity: LegacySeverity | undefined, impact: IncidentImpact): ComponentStatus {
  return SEVERITY_TO_COMPONENT_STATUS[severity ?? IMPACT_TO_SEVERITY[impact]] ?? 'degraded'
}

export interface TemplateDefaults {
  id: string
  title: string
  message: string
  impact: IncidentImpact
  status: TemplateStatus
  component_statuses: Record<string, ComponentStatus>
}

export interface IncidentCreatePlan {
  title: string
  message: string | null
  status: IncidentStatus
  impact: IncidentImpact
  components: Record<string, ComponentStatus>
  notifySubscribers: boolean
  source: IncidentSource
}

/**
 * Turns a create request into RPC arguments: fields sent win over the template; v0 `severity` becomes impact,
 * `component_ids` get the status the severity implied and `description` is the first message.
 */
export function planIncidentCreate(input: IncidentCreateInput, template: TemplateDefaults | null, index: ComponentIndexEntry[], actorType: DomainContext['actor']['type']): IncidentCreatePlan {
  const title = input.title ?? template?.title
  if (!title) throw invalid('Give the incident a title.', [{ path: 'title', message: 'Give the incident a title.' }])
  const impact: IncidentImpact = input.impact ?? (input.severity ? SEVERITY_TO_IMPACT[input.severity] : undefined) ?? template?.impact ?? 'minor'
  const status: IncidentStatus = input.status ?? template?.status ?? 'investigating'

  let components: Record<string, ComponentStatus> = {}
  if (input.components !== undefined || input.component_ids !== undefined) {
    const legacyStatus = legacyComponentStatus(input.severity, impact)
    for (const id of resolveComponentIds(index, input.component_ids ?? [])) components[id] = legacyStatus
    components = { ...components, ...resolveComponentMap(index, input.components ?? {}) }
  } else if (template) {
    // Templates may mention components deleted since; those are skipped.
    for (const [ref, componentStatus] of Object.entries(template.component_statuses)) {
      const component = findComponent(index, ref)
      if (component) components[component.id] = componentStatus
    }
  }

  const written = filled(input.message) ?? filled(input.description) ?? filled(template?.message)
  const message = written ?? (status === 'draft' ? null : DEFAULT_INCIDENT_MESSAGES[status])

  return {
    title: title.trim(),
    message,
    status,
    impact,
    components,
    notifySubscribers: input.notify_subscribers ?? true,
    source: actorType === 'api_key' ? 'api' : template ? 'template' : 'manual',
  }
}

/** v0 PUT `component_ids`: listed components stay or join the incident, the rest leave it. */
export function legacyComponentChanges(current: Array<{ component_id: string; status: ComponentStatus }>, ids: string[], status: ComponentStatus, keepExisting: boolean): Record<string, ComponentStatus | null> {
  const changes: Record<string, ComponentStatus | null> = {}
  for (const row of current) if (!ids.includes(row.component_id)) changes[row.component_id] = null
  for (const id of ids) {
    const existing = current.find((row) => row.component_id === id)
    if (!existing || !keepExisting) changes[id] = status
  }
  return changes
}

// ------------------------------------------------------------------ resources

interface IncidentRelations {
  components: Map<string, IncidentComponentResource[]>
  postmortems: Map<string, { id: string; status: 'draft' | 'published' }>
  names: Map<string, string>
  acknowledgers: Map<string, ActorResource>
}

export function toIncidentUpdateResource(row: IncidentUpdateRow, names: Map<string, string>): IncidentUpdateResource {
  return {
    id: row.id,
    kind: row.kind,
    visibility: row.visibility,
    status: row.status,
    message: row.message,
    component_statuses: row.component_statuses ?? {},
    notify_subscribers: row.notify_subscribers,
    actor: toActor(row.created_by, row.actor_label, names),
    created_at: row.created_at,
  }
}

export function toIncidentResource(row: IncidentRow, access: ProjectAccess, relations: IncidentRelations, updates?: IncidentUpdateResource[]): IncidentResource {
  const components = relations.components.get(row.id) ?? []
  let acknowledgedBy: ActorResource | null = null
  if (row.acknowledged_at) {
    acknowledgedBy = row.acknowledged_by
      ? { type: 'user', label: relations.names.get(row.acknowledged_by) ?? 'A team member' }
      : relations.acknowledgers.get(row.id) ?? null
  }
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    status: row.status,
    impact: row.impact,
    severity: IMPACT_TO_SEVERITY[row.impact] as LegacySeverity,
    source: row.source,
    components,
    component_ids: components.map((component) => component.component_id),
    detected_at: row.detected_at,
    acknowledged_at: row.acknowledged_at,
    acknowledged_by: acknowledgedBy,
    published_at: row.published_at,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    url: row.status === 'draft' ? null : statusPageLink(access, `/incidents/${row.id}`),
    postmortem: relations.postmortems.get(row.id) ?? null,
    ...(updates ? { updates } : {}),
  }
}

async function loadRelations(ctx: DomainContext, rows: IncidentRow[], extraUserIds: Array<string | null> = []): Promise<IncidentRelations> {
  const relations: IncidentRelations = { components: new Map(), postmortems: new Map(), names: new Map(), acknowledgers: new Map() }
  if (rows.length === 0) return relations
  const ids = rows.map((row) => row.id)
  const ackedWithoutUser = rows.filter((row) => row.acknowledged_at && !row.acknowledged_by).map((row) => row.id)
  const [componentsResult, postmortemsResult, ackRowsResult] = await Promise.all([
    ctx.db.from('incident_components').select('incident_id, component_id, status, component:components(slug, name, position)').in('incident_id', ids),
    ctx.db.from('postmortems').select('id, incident_id, status').in('incident_id', ids),
    ackedWithoutUser.length > 0
      ? ctx.db.from('incident_updates').select('incident_id, created_by, actor_label, created_at').in('incident_id', ackedWithoutUser).eq('kind', 'system').like('message', 'Acknowledged%').order('created_at')
      : Promise.resolve({ data: [], error: null }),
  ])

  type ComponentLink = { incident_id: string; component_id: string; status: ComponentStatus; component: { slug: string; name: string; position: number } | null }
  const links = (unwrap(componentsResult) as unknown as ComponentLink[])
    .filter((link) => link.component)
    .sort((a, b) => a.component!.position - b.component!.position || a.component!.name.localeCompare(b.component!.name))
  for (const link of links) {
    const list = relations.components.get(link.incident_id) ?? []
    list.push({ component_id: link.component_id, slug: link.component!.slug, name: link.component!.name, status: link.status })
    relations.components.set(link.incident_id, list)
  }
  for (const postmortem of unwrap(postmortemsResult) as Array<{ id: string; incident_id: string; status: 'draft' | 'published' }>) {
    relations.postmortems.set(postmortem.incident_id, { id: postmortem.id, status: postmortem.status })
  }
  const ackRows = unwrap(ackRowsResult) as Array<{ incident_id: string; created_by: string | null; actor_label: string | null }>

  relations.names = await loadProfileNames(ctx, [...rows.map((row) => row.acknowledged_by), ...ackRows.map((row) => row.created_by), ...extraUserIds])
  for (const row of ackRows) {
    if (!relations.acknowledgers.has(row.incident_id)) relations.acknowledgers.set(row.incident_id, toActor(row.created_by, row.actor_label, relations.names))
  }
  return relations
}

/** Loads a non-deleted incident of the project (not found for other projects, deleted rows and bad ids). */
export async function loadIncidentRow(ctx: DomainContext, projectId: string, incidentId: string): Promise<IncidentRow> {
  if (!isUuid(incidentId)) throw notFound('Incident')
  const result = await ctx.db.from('incidents').select(INCIDENT_COLUMNS).eq('id', incidentId).eq('project_id', projectId).is('deleted_at', null).maybeSingle()
  return unwrapOne(result, 'Incident') as IncidentRow
}

async function incidentResource(ctx: DomainContext, access: ProjectAccess, incidentId: string, withUpdates: boolean): Promise<IncidentResource> {
  return incidentResourceFromRow(ctx, access, await loadIncidentRow(ctx, access.project.id, incidentId), withUpdates)
}

async function incidentResourceFromRow(ctx: DomainContext, access: ProjectAccess, row: IncidentRow, withUpdates: boolean): Promise<IncidentResource> {
  if (!withUpdates) return toIncidentResource(row, access, await loadRelations(ctx, [row]))
  const updates = unwrap(
    await ctx.db.from('incident_updates').select('*').eq('incident_id', row.id).order('created_at', { ascending: false }).order('id', { ascending: false }),
  ) as IncidentUpdateRow[]
  const relations = await loadRelations(ctx, [row], updates.map((update) => update.created_by))
  return toIncidentResource(row, access, relations, updates.map((update) => toIncidentUpdateResource(update, relations.names)))
}

// ------------------------------------------------------------------ reads

export async function listIncidents(ctx: DomainContext, projectRef: string, filter: IncidentListFilter, page: PageRequest): Promise<{ access: ProjectAccess; page: Page<IncidentResource> }> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  let query = ctx.db.from('incidents').select(INCIDENT_COLUMNS).eq('project_id', access.project.id).is('deleted_at', null)
  if (filter === 'active') query = query.in('status', [...ACTIVE_INCIDENT_STATUSES])
  else if (filter === 'draft') query = query.eq('status', 'draft')
  else if (filter === 'resolved') query = query.eq('status', 'resolved')
  if (page.cursor) query = query.or(keysetFilter('created_at', page.cursor))
  const rows = unwrap(await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(page.limit + 1)) as IncidentRow[]
  const { items, nextCursor } = toPage(rows, page, (row) => row.created_at)
  const relations = await loadRelations(ctx, items)
  return { access, page: { items: items.map((row) => toIncidentResource(row, access, relations)), nextCursor } }
}

/** Number of active and draft incidents (filter badges in the panel). */
export async function countIncidents(ctx: DomainContext, projectRef: string): Promise<{ active: number; draft: number }> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const base = () => ctx.db.from('incidents').select('id', { count: 'exact', head: true }).eq('project_id', access.project.id).is('deleted_at', null)
  const [active, draft] = await Promise.all([base().in('status', [...ACTIVE_INCIDENT_STATUSES]), base().eq('status', 'draft')])
  if (active.error) throw fromDatabaseError(active.error)
  if (draft.error) throw fromDatabaseError(draft.error)
  return { active: active.count ?? 0, draft: draft.count ?? 0 }
}

export async function getIncident(ctx: DomainContext, projectRef: string, incidentId: string): Promise<IncidentResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return incidentResource(ctx, access, incidentId, true)
}

export interface IncidentView {
  access: ProjectAccess
  incident: IncidentResource
  /** Every component of the project, to add to the incident. */
  components: ComponentIndexEntry[]
  openedBy: ActorResource | null
  sourceMonitor: { id: string; name: string } | null
}

/** Everything the incident page needs in one call. */
export async function getIncidentView(ctx: DomainContext, projectRef: string, incidentId: string): Promise<IncidentView> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const row = await loadIncidentRow(ctx, access.project.id, incidentId)
  const [incident, components, monitor] = await Promise.all([
    incidentResourceFromRow(ctx, access, row, true),
    loadComponentIndex(ctx, access.project.id),
    row.source_monitor_id ? ctx.db.from('monitors').select('id, name').eq('id', row.source_monitor_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const names = row.created_by ? await loadProfileNames(ctx, [row.created_by]) : new Map<string, string>()
  const firstUpdate = incident.updates?.[incident.updates.length - 1]
  return {
    access,
    incident,
    components,
    openedBy: row.created_by ? { type: 'user', label: names.get(row.created_by) ?? 'A team member' } : firstUpdate?.actor ?? null,
    sourceMonitor: (monitor.data as { id: string; name: string } | null) ?? null,
  }
}

// ------------------------------------------------------------------ writes

async function loadTemplateDefaults(ctx: DomainContext, projectId: string, templateId: string): Promise<TemplateDefaults> {
  const row = unwrapOne(
    await ctx.db.from('incident_templates').select('id, title, message, impact, status, component_statuses').eq('id', templateId).eq('project_id', projectId).maybeSingle(),
    'Incident template',
  ) as TemplateDefaults
  return { ...row, component_statuses: row.component_statuses ?? {} }
}

export async function createIncident(ctx: DomainContext, projectRef: string, input: IncidentCreateInput): Promise<IncidentResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const [template, index] = await Promise.all([
    input.template_id ? loadTemplateDefaults(ctx, access.project.id, input.template_id) : Promise.resolve(null),
    loadComponentIndex(ctx, access.project.id),
  ])
  const plan = planIncidentCreate(input, template, index, ctx.actor.type)
  const { data, error } = await ctx.db.rpc('create_incident', {
    p_project_id: access.project.id,
    p_title: plan.title,
    p_message: plan.message,
    p_status: plan.status,
    p_impact: plan.impact,
    p_components: plan.components,
    p_notify_subscribers: plan.notifySubscribers,
    p_source: plan.source,
    p_actor_label: actorLabel(ctx),
  })
  if (error) throw fromDatabaseError(error, 'Incident')
  const row = data as IncidentRow
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'incident.created',
    targetType: 'incident',
    targetId: row.id,
    metadata: { title: row.title, status: row.status, impact: row.impact, components: Object.keys(plan.components).length, template_id: template?.id ?? null, notify_subscribers: plan.notifySubscribers },
  })
  if (row.status !== 'draft') touchStatusPage(access)
  return incidentResource(ctx, access, row.id, true)
}

async function applyDetails(ctx: DomainContext, access: ProjectAccess, current: IncidentRow, changes: { title?: string; impact?: IncidentImpact }): Promise<boolean> {
  const title = changes.title !== undefined && changes.title.trim() !== current.title ? changes.title.trim() : undefined
  const impact = changes.impact !== undefined && changes.impact !== current.impact ? changes.impact : undefined
  if (title === undefined && impact === undefined) return false
  const { error } = await ctx.db.rpc('update_incident_details', { p_incident_id: current.id, p_title: title ?? null, p_impact: impact ?? null, p_actor_label: actorLabel(ctx) })
  if (error) throw fromDatabaseError(error, 'Incident')
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'incident.updated',
    targetType: 'incident',
    targetId: current.id,
    metadata: { ...(title !== undefined ? { title, previous_title: current.title } : {}), ...(impact !== undefined ? { impact, previous_impact: current.impact } : {}) },
  })
  if (current.status !== 'draft') touchStatusPage(access)
  return true
}

export async function updateIncident(ctx: DomainContext, projectRef: string, incidentId: string, input: IncidentPatchInput): Promise<IncidentResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadIncidentRow(ctx, access.project.id, incidentId)
  await applyDetails(ctx, access, current, input)
  return incidentResource(ctx, access, current.id, true)
}

interface UpdateRequest {
  status: IncidentStatus | null
  message: string
  visibility: 'public' | 'internal'
  components: Record<string, ComponentStatus | null> | null
  notifySubscribers: boolean
}

async function postUpdate(ctx: DomainContext, access: ProjectAccess, current: IncidentRow, request: UpdateRequest): Promise<IncidentUpdateRow> {
  const isPublic = request.visibility === 'public'
  const { data, error } = await ctx.db.rpc('post_incident_update', {
    p_incident_id: current.id,
    p_status: isPublic ? request.status : null,
    p_message: request.message,
    p_visibility: request.visibility,
    p_components: isPublic ? request.components : null,
    p_notify_subscribers: isPublic && request.notifySubscribers,
    p_actor_label: actorLabel(ctx),
  })
  if (error) throw fromDatabaseError(error, 'Incident')
  const row = data as IncidentUpdateRow
  const nextStatus = isPublic ? request.status ?? current.status : current.status
  const action = !isPublic
    ? 'incident.note_added'
    : current.status === 'draft'
      ? 'incident.published'
      : nextStatus === 'resolved' && current.status !== 'resolved'
        ? 'incident.resolved'
        : 'incident.update_posted'
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action,
    targetType: 'incident',
    targetId: current.id,
    metadata: {
      update_id: row.id,
      visibility: request.visibility,
      status: nextStatus,
      previous_status: current.status,
      components: request.components ? Object.keys(request.components).length : 0,
      notify_subscribers: row.notify_subscribers,
    },
  })
  if (isPublic) touchStatusPage(access)
  return row
}

export async function postIncidentUpdate(ctx: DomainContext, projectRef: string, incidentId: string, input: IncidentUpdateInput): Promise<IncidentUpdateResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadIncidentRow(ctx, access.project.id, incidentId)
  const isPublic = input.visibility === 'public'
  if (isPublic && current.status === 'draft' && !input.status) {
    throw conflict('This incident is a draft. Publish it first, or post an internal note.')
  }
  const components = isPublic && input.components ? resolveComponentMap(await loadComponentIndex(ctx, access.project.id), input.components) : null
  const row = await postUpdate(ctx, access, current, {
    status: input.status ?? null,
    message: input.message,
    visibility: input.visibility,
    components,
    notifySubscribers: input.notify_subscribers,
  })
  return toIncidentUpdateResource(row, await loadProfileNames(ctx, [row.created_by]))
}

/** Publishes a draft: its first public update moves it to `status` and applies its component statuses. */
export async function publishIncident(ctx: DomainContext, projectRef: string, incidentId: string, input: IncidentPublishInput): Promise<IncidentResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadIncidentRow(ctx, access.project.id, incidentId)
  if (current.status !== 'draft') throw conflict('This incident is already public. Post an update instead.')
  const components = input.components ? resolveComponentMap(await loadComponentIndex(ctx, access.project.id), input.components) : null
  await postUpdate(ctx, access, current, {
    status: input.status,
    message: input.message?.trim() || DEFAULT_INCIDENT_MESSAGES[input.status],
    visibility: 'public',
    components,
    notifySubscribers: input.notify_subscribers,
  })
  return incidentResource(ctx, access, current.id, true)
}

/** v0 PUT: changes title/impact (severity) and turns a message, status or component change into a public update. */
export async function legacyUpdateIncident(ctx: DomainContext, projectRef: string, incidentId: string, input: IncidentLegacyUpdateInput): Promise<IncidentResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadIncidentRow(ctx, access.project.id, incidentId)
  const impact = input.impact ?? (input.severity ? SEVERITY_TO_IMPACT[input.severity] : undefined)
  const message = (input.message ?? input.description)?.trim()
  const wantsUpdate = Boolean(message) || input.status !== undefined || input.component_ids !== undefined || input.components !== undefined
  const status = input.status ?? (current.status === 'draft' ? undefined : current.status)
  if (wantsUpdate && !status) throw conflict('This incident is a draft. Publish it first, or send a status to publish it.')

  let components: Record<string, ComponentStatus | null> | null = null
  if (wantsUpdate && (input.component_ids !== undefined || input.components !== undefined)) {
    const index = await loadComponentIndex(ctx, access.project.id)
    components = {}
    if (input.component_ids !== undefined) {
      const currentLinks = unwrap(await ctx.db.from('incident_components').select('component_id, status').eq('incident_id', current.id)) as Array<{ component_id: string; status: ComponentStatus }>
      const ids = resolveComponentIds(index, input.component_ids)
      components = legacyComponentChanges(currentLinks, ids, legacyComponentStatus(input.severity, impact ?? current.impact), input.severity === undefined)
    }
    components = { ...components, ...resolveComponentMap(index, input.components ?? {}) }
  }

  await applyDetails(ctx, access, current, { title: input.title, impact })
  if (wantsUpdate && status) {
    const fresh = await loadIncidentRow(ctx, access.project.id, current.id)
    await postUpdate(ctx, access, fresh, {
      status,
      message: message || DEFAULT_INCIDENT_MESSAGES[status],
      visibility: 'public',
      components,
      notifySubscribers: input.notify_subscribers ?? true,
    })
  }
  return incidentResource(ctx, access, current.id, true)
}

export async function acknowledgeIncident(ctx: DomainContext, projectRef: string, incidentId: string): Promise<IncidentResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadIncidentRow(ctx, access.project.id, incidentId)
  if (!current.acknowledged_at) {
    const { error } = await ctx.db.rpc('acknowledge_incident', { p_incident_id: current.id, p_actor_label: actorLabel(ctx) })
    if (error) throw fromDatabaseError(error, 'Incident')
    await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'incident.acknowledged', targetType: 'incident', targetId: current.id, metadata: { title: current.title } })
  }
  return incidentResource(ctx, access, current.id, true)
}

/** Soft delete (admin): the incident disappears from the status page and stops owning its components. */
export async function deleteIncident(ctx: DomainContext, projectRef: string, incidentId: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await loadIncidentRow(ctx, access.project.id, incidentId)
  const { error } = await ctx.db.rpc('delete_incident', { p_incident_id: current.id, p_actor_label: actorLabel(ctx) })
  if (error) throw fromDatabaseError(error, 'Incident')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'incident.deleted', targetType: 'incident', targetId: current.id, metadata: { title: current.title, status: current.status } })
  touchStatusPage(access)
}
