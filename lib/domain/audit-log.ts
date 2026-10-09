import 'server-only'
import type { Plan } from '@shared/plans.ts'
import { requireDashboardUser, requireOrganization } from './access'
import { audit } from './audit'
import type { DomainContext } from './context'
import { DomainError, fromDatabaseError, invalid } from './errors'
import { decodeCursor, encodeCursor, keysetFilter, type Cursor } from './pagination'
import type { AuditEntryResource, AuditLogFilters } from './schemas/organizations'
import type { AuditLogRow } from './types'

export const AUDIT_PAGE_SIZE = 50
export const AUDIT_EXPORT_MAX_ROWS = 10_000
const EXPORT_BATCH = 1_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Action prefixes offered by the filter (actions are `<area>.<verb>`). */
export const AUDIT_ACTION_GROUPS: Array<{ value: string; label: string }> = [
  { value: 'incident', label: 'Incidents' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'component', label: 'Components' },
  { value: 'monitor', label: 'Monitors' },
  { value: 'alert', label: 'Alerts' },
  { value: 'status_page', label: 'Status page' },
  { value: 'project', label: 'Status pages (projects)' },
  { value: 'subscriber', label: 'Subscribers' },
  { value: 'member', label: 'Members' },
  { value: 'invitation', label: 'Invitations' },
  { value: 'api_key', label: 'API keys' },
  { value: 'organization', label: 'Organization' },
  { value: 'billing', label: 'Billing' },
]

/** CSV export of the audit log is a Business feature (spec §1: "audit log export"). */
export function auditExportAllowed(plan: Plan | string | null | undefined): boolean {
  return plan === 'business'
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

// PostgREST query builders are deeply generic; filters only need these chainable methods.
interface FilterableQuery<T> {
  like(column: string, pattern: string): T
  eq(column: string, value: unknown): T
  gte(column: string, value: unknown): T
  lt(column: string, value: unknown): T
  or(filters: string): T
}

export function applyAuditFilters<T extends FilterableQuery<T>>(query: T, filters: AuditLogFilters, cursor: Cursor | null): T {
  let next = query
  if (filters.action) next = next.like('action', `${filters.action.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
  if (filters.actor) next = next.eq('actor_type', filters.actor)
  if (filters.from) next = next.gte('created_at', `${filters.from}T00:00:00Z`)
  if (filters.to) next = next.lt('created_at', nextDay(filters.to))
  if (cursor) next = next.or(keysetFilter('created_at', cursor))
  return next
}

interface LabelMaps {
  people: Map<string, string>
  keys: Map<string, string>
  projects: Map<string, string>
}

async function labelMaps(ctx: DomainContext, rows: AuditLogRow[]): Promise<LabelMaps> {
  const people = new Set<string>()
  const keys = new Set<string>()
  const projects = new Set<string>()
  for (const row of rows) {
    if (row.actor_type === 'user' && row.actor_id && UUID.test(row.actor_id)) people.add(row.actor_id)
    if (row.actor_type === 'api_key' && row.actor_id && UUID.test(row.actor_id)) keys.add(row.actor_id)
    if (row.target_type === 'user' && row.target_id && UUID.test(row.target_id)) people.add(row.target_id)
    if (row.target_type === 'api_key' && row.target_id && UUID.test(row.target_id)) keys.add(row.target_id)
    if (row.project_id) projects.add(row.project_id)
  }
  const [peopleRows, keyRows, projectRows] = await Promise.all([
    people.size > 0 ? ctx.db.from('profiles').select('id, name, username').in('id', [...people]) : Promise.resolve({ data: [] }),
    keys.size > 0 ? ctx.db.from('api_keys').select('id, name').in('id', [...keys]) : Promise.resolve({ data: [] }),
    projects.size > 0 ? ctx.db.from('projects').select('id, name').in('id', [...projects]) : Promise.resolve({ data: [] }),
  ])
  return {
    people: new Map(((peopleRows.data ?? []) as Array<{ id: string; name: string | null; username: string | null }>).map((row) => [row.id, row.name?.trim() || row.username || 'Team member'])),
    keys: new Map(((keyRows.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])),
    projects: new Map(((projectRows.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])),
  }
}

function metadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value : null
}

export function toAuditEntry(row: AuditLogRow, maps: LabelMaps): AuditEntryResource {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>
  let actorLabel = row.actor_label
  if (!actorLabel) {
    if (row.actor_type === 'user') actorLabel = (row.actor_id && maps.people.get(row.actor_id)) || 'Former member'
    else if (row.actor_type === 'api_key') actorLabel = `API key ${(row.actor_id && maps.keys.get(row.actor_id)) || '(deleted)'}`
    else actorLabel = 'Upvane'
  }
  let targetLabel = metadataText(metadata, 'name') ?? metadataText(metadata, 'title') ?? metadataText(metadata, 'email')
  if (!targetLabel && row.target_id) {
    if (row.target_type === 'user') targetLabel = maps.people.get(row.target_id) ?? null
    else if (row.target_type === 'api_key') targetLabel = maps.keys.get(row.target_id) ?? null
    else if (row.target_type === 'project') targetLabel = maps.projects.get(row.target_id) ?? null
  }
  return {
    id: String(row.id),
    created_at: row.created_at,
    actor: { type: row.actor_type, id: row.actor_id, label: actorLabel },
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    target_label: targetLabel,
    project_id: row.project_id,
    metadata,
    ip: row.ip,
  }
}

function safeCursor(value: string | null | undefined): Cursor | null {
  try {
    return decodeCursor(value)
  } catch {
    throw invalid('This page of the audit log is no longer available. Start from the newest entries.')
  }
}

async function fetchRows(ctx: DomainContext, organizationId: string, filters: AuditLogFilters, cursor: Cursor | null, limit: number): Promise<AuditLogRow[]> {
  const query = applyAuditFilters(ctx.db.from('audit_logs').select('*').eq('organization_id', organizationId), filters, cursor)
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  if (error) throw fromDatabaseError(error, 'Audit log')
  return (data ?? []) as AuditLogRow[]
}

/** One page of the audit log, newest first, with keyset pagination on (created_at, id). Admins only. */
export async function listAuditLog(
  ctx: DomainContext,
  organizationId: string,
  filters: AuditLogFilters,
  cursor: string | null = null,
  limit: number = AUDIT_PAGE_SIZE,
): Promise<{ entries: AuditEntryResource[]; nextCursor: string | null }> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'admin')
  const rows = await fetchRows(ctx, access.organization.id, filters, safeCursor(cursor), limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const maps = await labelMaps(ctx, page)
  return {
    entries: page.map((row) => toAuditEntry(row, maps)),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.created_at, id: String(last.id) }) : null,
  }
}

// ------------------------------------------------------------------ CSV

/** One CSV cell (RFC 4180), with spreadsheet formula injection neutralised. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export const AUDIT_CSV_HEADER = ['time', 'actor_type', 'actor', 'actor_id', 'action', 'target_type', 'target', 'target_id', 'status_page_id', 'ip', 'metadata']

export function auditEntriesToCsv(entries: AuditEntryResource[]): string {
  const rows: unknown[][] = [AUDIT_CSV_HEADER]
  for (const entry of entries) {
    const { request_id: _requestId, ...metadata } = entry.metadata
    rows.push([
      entry.created_at,
      entry.actor.type,
      entry.actor.label,
      entry.actor.id,
      entry.action,
      entry.target_type,
      entry.target_label,
      entry.target_id,
      entry.project_id,
      entry.ip,
      Object.keys(metadata).length > 0 ? metadata : '',
    ])
  }
  return toCsv(rows)
}

/** CSV of the filtered audit log (up to 10,000 rows, newest first). Business plan, admins only. */
export async function exportAuditLogCsv(ctx: DomainContext, organizationId: string, filters: AuditLogFilters): Promise<{ filename: string; csv: string; rows: number; truncated: boolean }> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'admin')
  if (!auditExportAllowed(access.organization.plan)) {
    throw new DomainError('plan_required', 'Exporting the audit log is part of the Business plan. Upgrade to download it as CSV.')
  }
  const entries: AuditEntryResource[] = []
  let cursor: Cursor | null = null
  let truncated = false
  while (entries.length < AUDIT_EXPORT_MAX_ROWS) {
    const rows = await fetchRows(ctx, access.organization.id, filters, cursor, EXPORT_BATCH)
    if (rows.length === 0) break
    const room = AUDIT_EXPORT_MAX_ROWS - entries.length
    const batch = rows.slice(0, room)
    const maps = await labelMaps(ctx, batch)
    entries.push(...batch.map((row) => toAuditEntry(row, maps)))
    if (rows.length > room) truncated = true
    if (rows.length < EXPORT_BATCH || truncated) break
    const last = rows[rows.length - 1]!
    cursor = { at: last.created_at, id: String(last.id) }
  }
  if (!truncated && entries.length >= AUDIT_EXPORT_MAX_ROWS && cursor) {
    truncated = (await fetchRows(ctx, access.organization.id, filters, cursor, 1)).length > 0
  }
  await audit(ctx, { organizationId: access.organization.id, action: 'audit_log.exported', targetType: 'organization', targetId: access.organization.id, metadata: { rows: entries.length, filters } })
  const stamp = new Date().toISOString().slice(0, 10)
  return { filename: `upvane-audit-log-${access.organization.slug}-${stamp}.csv`, csv: '﻿' + auditEntriesToCsv(entries), rows: entries.length, truncated }
}
