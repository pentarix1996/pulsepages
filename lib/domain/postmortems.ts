import 'server-only'
import type { IncidentImpact, IncidentStatus } from '@shared/domain.ts'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import { actorUserId, type DomainContext } from './context'
import { conflict, fromDatabaseError, notFound, unwrap, unwrapOne } from './errors'
import { loadIncidentRow, touchStatusPage } from './incidents'
import type { PostmortemActionItemInput, PostmortemInput, PostmortemResource, PostmortemTimelineEntryInput } from './schemas/postmortems'
import type { IncidentRow, PostmortemActionItem, PostmortemRow, PostmortemTimelineEntry } from './types'

type LooseRecord = Record<string, unknown>

function isRecord(value: unknown): value is LooseRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Rows written by older code or by hand may miss fields; the resource is always complete. */
export function toPostmortemResource(row: PostmortemRow): PostmortemResource {
  const items: unknown[] = Array.isArray(row.action_items) ? row.action_items : []
  const timeline: unknown[] = Array.isArray(row.timeline) ? row.timeline : []
  return {
    id: row.id,
    incident_id: row.incident_id,
    status: row.status,
    title: row.title,
    summary: row.summary ?? '',
    impact: row.impact ?? '',
    root_cause: row.root_cause ?? '',
    resolution: row.resolution ?? '',
    lessons: row.lessons ?? '',
    action_items: items.filter(isRecord).map((item, index) => ({
      id: text(item.id) ?? `item-${index + 1}`,
      title: typeof item.title === 'string' ? item.title : '',
      owner: text(item.owner),
      due_date: text(item.due_date),
      done: item.done === true,
      url: text(item.url),
    })),
    timeline: timeline
      .filter(isRecord)
      .filter((entry) => typeof entry.at === 'string')
      .map((entry) => ({
        at: entry.at as string,
        message: typeof entry.message === 'string' ? entry.message : '',
        kind: text(entry.kind),
        visibility: text(entry.visibility),
        status: text(entry.status),
      })),
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function newItemId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

export function normalizeActionItems(items: PostmortemActionItemInput[]): PostmortemActionItem[] {
  const seen = new Set<string>()
  return items.map((item) => {
    let id = item.id?.trim() || newItemId()
    if (seen.has(id)) id = newItemId()
    seen.add(id)
    return { id, title: item.title, owner: item.owner || null, due_date: item.due_date || null, done: item.done, url: item.url || null }
  })
}

/** Timeline entries are kept in time order. */
export function normalizeTimeline(entries: PostmortemTimelineEntryInput[]): PostmortemTimelineEntry[] {
  return entries
    .map((entry) => ({
      at: new Date(entry.at).toISOString(),
      message: entry.message,
      ...(entry.kind ? { kind: entry.kind } : {}),
      ...(entry.visibility ? { visibility: entry.visibility } : {}),
      ...(entry.status ? { status: entry.status } : {}),
    }))
    .sort((a, b) => a.at.localeCompare(b.at))
}

async function loadPostmortemRow(ctx: DomainContext, incidentId: string): Promise<PostmortemRow | null> {
  return unwrap(await ctx.db.from('postmortems').select('*').eq('incident_id', incidentId).maybeSingle()) as PostmortemRow | null
}

async function ensurePostmortemRow(ctx: DomainContext, access: ProjectAccess, incident: IncidentRow): Promise<PostmortemRow> {
  const existing = await loadPostmortemRow(ctx, incident.id)
  if (existing) return existing
  const { error } = await ctx.db.rpc('ensure_postmortem_draft', { p_incident_id: incident.id, p_force: true })
  if (error) throw fromDatabaseError(error, 'Incident')
  const row = await loadPostmortemRow(ctx, incident.id)
  if (!row) throw notFound('Postmortem')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'postmortem.created', targetType: 'postmortem', targetId: row.id, metadata: { incident_id: incident.id } })
  return row
}

async function writePostmortem(ctx: DomainContext, row: PostmortemRow, patch: Record<string, unknown>): Promise<PostmortemRow> {
  return unwrapOne(
    await ctx.db.from('postmortems').update({ ...patch, updated_by: actorUserId(ctx) }).eq('id', row.id).select('*').maybeSingle(),
    'Postmortem',
  ) as PostmortemRow
}

export async function getPostmortem(ctx: DomainContext, projectRef: string, incidentId: string): Promise<PostmortemResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const incident = await loadIncidentRow(ctx, access.project.id, incidentId)
  const row = await loadPostmortemRow(ctx, incident.id)
  if (!row) throw notFound('Postmortem')
  return toPostmortemResource(row)
}

export interface PostmortemIncidentSummary {
  id: string
  title: string
  status: IncidentStatus
  impact: IncidentImpact
  detected_at: string
  acknowledged_at: string | null
  published_at: string | null
  resolved_at: string | null
}

export interface PostmortemView {
  access: ProjectAccess
  postmortem: PostmortemResource
  incident: PostmortemIncidentSummary
}

/** The editor page addresses postmortems by their own id. */
export async function getPostmortemView(ctx: DomainContext, projectRef: string, postmortemId: string): Promise<PostmortemView> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  if (!isUuid(postmortemId)) throw notFound('Postmortem')
  const row = unwrapOne(await ctx.db.from('postmortems').select('*').eq('id', postmortemId).eq('project_id', access.project.id).maybeSingle(), 'Postmortem') as PostmortemRow
  const incident = await loadIncidentRow(ctx, access.project.id, row.incident_id)
  return {
    access,
    postmortem: toPostmortemResource(row),
    incident: {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
      detected_at: incident.detected_at,
      acknowledged_at: incident.acknowledged_at,
      published_at: incident.published_at,
      resolved_at: incident.resolved_at,
    },
  }
}

/** Creates the draft (prefilled with the incident timeline) when there is none yet. */
export async function createPostmortem(ctx: DomainContext, projectRef: string, incidentId: string): Promise<PostmortemResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const incident = await loadIncidentRow(ctx, access.project.id, incidentId)
  return toPostmortemResource(await ensurePostmortemRow(ctx, access, incident))
}

export async function savePostmortem(ctx: DomainContext, projectRef: string, incidentId: string, input: PostmortemInput): Promise<PostmortemResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const incident = await loadIncidentRow(ctx, access.project.id, incidentId)
  const row = await ensurePostmortemRow(ctx, access, incident)
  const patch: Record<string, unknown> = {}
  for (const field of ['title', 'summary', 'impact', 'root_cause', 'resolution', 'lessons'] as const) {
    if (input[field] !== undefined) patch[field] = input[field]
  }
  if (input.action_items !== undefined) patch.action_items = normalizeActionItems(input.action_items)
  if (input.timeline !== undefined) patch.timeline = normalizeTimeline(input.timeline)
  if (Object.keys(patch).length === 0) return toPostmortemResource(row)
  const updated = await writePostmortem(ctx, row, patch)
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'postmortem.updated', targetType: 'postmortem', targetId: row.id, metadata: { incident_id: incident.id, fields: Object.keys(patch) } })
  if (updated.status === 'published') touchStatusPage(access)
  return toPostmortemResource(updated)
}

export async function publishPostmortem(ctx: DomainContext, projectRef: string, incidentId: string): Promise<PostmortemResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const incident = await loadIncidentRow(ctx, access.project.id, incidentId)
  const row = await loadPostmortemRow(ctx, incident.id)
  if (!row) throw notFound('Postmortem')
  if (row.status === 'published') return toPostmortemResource(row)
  if (incident.status !== 'resolved') throw conflict('Resolve the incident before publishing its postmortem.')
  const updated = await writePostmortem(ctx, row, { status: 'published', published_at: new Date().toISOString() })
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'postmortem.published', targetType: 'postmortem', targetId: row.id, metadata: { incident_id: incident.id, title: updated.title } })
  touchStatusPage(access)
  return toPostmortemResource(updated)
}

/** Takes a published postmortem off the status page; it becomes a draft again. */
export async function unpublishPostmortem(ctx: DomainContext, projectRef: string, incidentId: string): Promise<PostmortemResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const incident = await loadIncidentRow(ctx, access.project.id, incidentId)
  const row = await loadPostmortemRow(ctx, incident.id)
  if (!row) throw notFound('Postmortem')
  if (row.status === 'draft') return toPostmortemResource(row)
  const updated = await writePostmortem(ctx, row, { status: 'draft', published_at: null })
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'postmortem.unpublished', targetType: 'postmortem', targetId: row.id, metadata: { incident_id: incident.id } })
  touchStatusPage(access)
  return toPostmortemResource(updated)
}
