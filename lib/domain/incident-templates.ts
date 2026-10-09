import 'server-only'
import type { ComponentStatus } from '@shared/domain.ts'
import { isUuid, requireProject } from './access'
import { audit } from './audit'
import { actorUserId, type DomainContext } from './context'
import { notFound, unwrap, unwrapOne } from './errors'
import { componentNotFound, findComponent, loadComponentIndex, type ComponentIndexEntry } from './incidents'
import type { IncidentTemplateCreateInput, IncidentTemplateResource, IncidentTemplateUpdateInput } from './schemas/incidents'
import type { IncidentTemplateRow } from './types'

export function toIncidentTemplateResource(row: IncidentTemplateRow): IncidentTemplateResource {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    message: row.message,
    impact: row.impact,
    status: row.status,
    component_statuses: row.component_statuses ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * Validates component references and keeps them the way they were written (id, or key in lowercase), so a
 * Terraform plan reads back what it wrote. References are resolved again when an incident uses the template.
 */
export function normalizeTemplateComponents(index: ComponentIndexEntry[], statuses: Record<string, ComponentStatus>): Record<string, ComponentStatus> {
  const normalized: Record<string, ComponentStatus> = {}
  for (const [ref, componentStatus] of Object.entries(statuses)) {
    const component = findComponent(index, ref)
    if (!component) throw componentNotFound(ref)
    normalized[component.id === ref.trim() ? component.id : component.slug] = componentStatus
  }
  return normalized
}

async function loadTemplateRow(ctx: DomainContext, projectId: string, templateId: string): Promise<IncidentTemplateRow> {
  if (!isUuid(templateId)) throw notFound('Incident template')
  return unwrapOne(await ctx.db.from('incident_templates').select('*').eq('id', templateId).eq('project_id', projectId).maybeSingle(), 'Incident template') as IncidentTemplateRow
}

export async function listIncidentTemplates(ctx: DomainContext, projectRef: string): Promise<IncidentTemplateResource[]> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const rows = unwrap(await ctx.db.from('incident_templates').select('*').eq('project_id', access.project.id).order('name')) as IncidentTemplateRow[]
  return rows.map(toIncidentTemplateResource)
}

export async function getIncidentTemplate(ctx: DomainContext, projectRef: string, templateId: string): Promise<IncidentTemplateResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return toIncidentTemplateResource(await loadTemplateRow(ctx, access.project.id, templateId))
}

export async function createIncidentTemplate(ctx: DomainContext, projectRef: string, input: IncidentTemplateCreateInput): Promise<IncidentTemplateResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const componentStatuses = normalizeTemplateComponents(await loadComponentIndex(ctx, access.project.id), input.component_statuses)
  const row = unwrapOne(
    await ctx.db
      .from('incident_templates')
      .insert({
        project_id: access.project.id,
        name: input.name,
        title: input.title,
        message: input.message,
        impact: input.impact,
        status: input.status,
        component_statuses: componentStatuses,
        created_by: actorUserId(ctx),
      })
      .select('*')
      .single(),
    'Incident template',
  ) as IncidentTemplateRow
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'incident_template.created', targetType: 'incident_template', targetId: row.id, metadata: { name: row.name } })
  return toIncidentTemplateResource(row)
}

export async function updateIncidentTemplate(ctx: DomainContext, projectRef: string, templateId: string, input: IncidentTemplateUpdateInput): Promise<IncidentTemplateResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadTemplateRow(ctx, access.project.id, templateId)
  const patch: Record<string, unknown> = {}
  for (const field of ['name', 'title', 'message', 'impact', 'status'] as const) {
    if (input[field] !== undefined) patch[field] = input[field]
  }
  if (input.component_statuses !== undefined) {
    patch.component_statuses = normalizeTemplateComponents(await loadComponentIndex(ctx, access.project.id), input.component_statuses)
  }
  if (Object.keys(patch).length === 0) return toIncidentTemplateResource(current)
  const row = unwrapOne(
    await ctx.db.from('incident_templates').update(patch).eq('id', current.id).eq('project_id', access.project.id).select('*').maybeSingle(),
    'Incident template',
  ) as IncidentTemplateRow
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'incident_template.updated', targetType: 'incident_template', targetId: row.id, metadata: { changes: Object.keys(patch) } })
  return toIncidentTemplateResource(row)
}

export async function deleteIncidentTemplate(ctx: DomainContext, projectRef: string, templateId: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await loadTemplateRow(ctx, access.project.id, templateId)
  const deleted = unwrap(await ctx.db.from('incident_templates').delete().eq('id', current.id).eq('project_id', access.project.id).select('id')) as Array<{ id: string }>
  if (deleted.length === 0) throw notFound('Incident template')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'incident_template.deleted', targetType: 'incident_template', targetId: current.id, metadata: { name: current.name } })
}
