import 'server-only'
import { ACTIVE_INCIDENT_STATUSES, OVERALL_STATUS_HEADLINES, statusRank, worstStatus, type ComponentStatus, type IncidentImpact, type IncidentStatus, type MaintenanceStatus, type OrgRole } from '@shared/domain.ts'
import { statusPageUrl } from '@shared/alerts/message.ts'
import { planLimit, withinLimit, type Plan } from '@shared/plans.ts'
import { env } from '@/lib/env'
import { listMemberships, requireOrganization, requireProject, requireWriteScope, type ProjectAccess } from './access'
import { audit } from './audit'
import { invalidateStatusPage } from './cache'
import type { DomainContext } from './context'
import { conflict, DomainError, forbidden, fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import {
  slugifyProjectName,
  uniqueProjectSlug,
  type ProjectCreateInput,
  type ProjectResource,
  type ProjectStatusResource,
  type ProjectUpdateInput,
} from './schemas/projects'
import type { ProjectRow } from './types'

const PROJECT_COLUMNS =
  'id, organization_id, user_id, name, slug, description, created_at, updated_at, visibility, brand_color, logo_url, theme_default, timezone, hide_powered_by, custom_domain, custom_domain_status, custom_domain_verified_at, custom_domain_error, allowed_ips, support_url, auto_postmortem, auto_draft_incidents, uptime_weights'

const DEFAULT_WEIGHTS = { major_outage: 1, partial_outage: 0.3, degraded: 0 }

/** Public URL of a status page: the custom domain once verified, else /status/{org}/{slug}. */
export function projectStatusPageUrl(project: Pick<ProjectRow, 'slug' | 'custom_domain' | 'custom_domain_status'>, organizationSlug: string, subPath = ''): string {
  return statusPageUrl(
    { organization_slug: organizationSlug, slug: project.slug, custom_domain: project.custom_domain_status === 'verified' ? project.custom_domain : null },
    { appUrl: env.appUrl() },
    subPath,
  )
}

function weight(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function toProjectResource(row: ProjectRow, organizationSlug: string): ProjectResource {
  const weights = (row.uptime_weights ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility,
    status_page_url: projectStatusPageUrl(row, organizationSlug),
    custom_domain: row.custom_domain,
    custom_domain_status: row.custom_domain_status,
    custom_domain_error: row.custom_domain_error ?? null,
    brand_color: row.brand_color,
    logo_url: row.logo_url,
    theme_default: row.theme_default,
    timezone: row.timezone,
    support_url: row.support_url,
    hide_powered_by: row.hide_powered_by,
    auto_postmortem: row.auto_postmortem,
    auto_draft_incidents: row.auto_draft_incidents,
    allowed_ips: row.allowed_ips ?? [],
    uptime_weights: {
      major_outage: weight(weights.major_outage, DEFAULT_WEIGHTS.major_outage),
      partial_outage: weight(weights.partial_outage, DEFAULT_WEIGHTS.partial_outage),
      degraded: weight(weights.degraded, DEFAULT_WEIGHTS.degraded),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function touchStatusPage(organizationSlug: string, ...slugs: string[]): void {
  for (const slug of new Set(slugs)) invalidateStatusPage(organizationSlug, slug)
}

// ------------------------------------------------------------------ reads
/** Status pages the actor can read (API key: its organization, or its single page). */
export async function listProjects(ctx: DomainContext): Promise<ProjectResource[]> {
  let query = ctx.db.from('projects').select(`${PROJECT_COLUMNS}, organization:organizations(slug)`).order('created_at', { ascending: true })
  if (ctx.actor.type === 'api_key') {
    query = query.eq('organization_id', ctx.actor.organizationId)
    if (ctx.actor.projectId) query = query.eq('id', ctx.actor.projectId)
  }
  const rows = unwrap(await query) as unknown as Array<ProjectRow & { organization: { slug: string } | null }>
  return rows.map(({ organization, ...row }) => toProjectResource(row as ProjectRow, organization?.slug ?? (ctx.actor.type === 'api_key' ? ctx.actor.organizationSlug : '')))
}

export async function getProject(ctx: DomainContext, projectRef: string): Promise<ProjectResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return toProjectResource(access.project, access.organization.slug)
}

export interface PanelProject {
  id: string
  name: string
  slug: string
  description: string | null
  visibility: 'public' | 'private'
  status_page_url: string
  status: ComponentStatus
  components: number
  open_incidents: number
  worst_impact: IncidentImpact | null
  created_at: string
}

export interface PanelOrganization {
  id: string
  name: string
  slug: string
  plan: Plan
  personal: boolean
  role: OrgRole
  /** Admins and owners can create pages here (plan room permitting). */
  can_create: boolean
  /** Pages the plan allows (-1 unlimited). */
  project_limit: number
  projects: PanelProject[]
}

/** Status pages grouped by organization for /projects (dashboard users only). */
export async function listProjectsForPanel(ctx: DomainContext): Promise<PanelOrganization[]> {
  const memberships = await listMemberships(ctx)
  if (memberships.length === 0) return []
  const [projectsResult, componentsResult, incidentsResult] = await Promise.all([
    ctx.db.from('projects').select('id, organization_id, name, slug, description, visibility, custom_domain, custom_domain_status, created_at').order('created_at', { ascending: true }),
    ctx.db.from('components').select('project_id, status'),
    ctx.db.from('incidents').select('project_id, impact').in('status', [...ACTIVE_INCIDENT_STATUSES]).is('deleted_at', null),
  ])
  const projects = unwrap(projectsResult) as Array<Pick<ProjectRow, 'id' | 'organization_id' | 'name' | 'slug' | 'description' | 'visibility' | 'custom_domain' | 'custom_domain_status' | 'created_at'>>
  const components = unwrap(componentsResult) as Array<{ project_id: string; status: ComponentStatus }>
  const incidents = unwrap(incidentsResult) as Array<{ project_id: string; impact: IncidentImpact }>

  const statusByProject = new Map<string, { worst: ComponentStatus | null; count: number }>()
  for (const component of components) {
    const entry = statusByProject.get(component.project_id) ?? { worst: null, count: 0 }
    entry.count += 1
    entry.worst = worstStatus(entry.worst, component.status)
    statusByProject.set(component.project_id, entry)
  }
  const incidentsByProject = new Map<string, { count: number; worst: IncidentImpact | null }>()
  const impactOrder: IncidentImpact[] = ['none', 'minor', 'major', 'critical']
  for (const incident of incidents) {
    const entry = incidentsByProject.get(incident.project_id) ?? { count: 0, worst: null }
    entry.count += 1
    if (!entry.worst || impactOrder.indexOf(incident.impact) > impactOrder.indexOf(entry.worst)) entry.worst = incident.impact
    incidentsByProject.set(incident.project_id, entry)
  }

  return memberships.map(({ organization, role }) => {
    const own = projects.filter((project) => project.organization_id === organization.id)
    const isAdmin = role === 'admin' || role === 'owner'
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: organization.plan,
      personal: organization.personal,
      role,
      can_create: isAdmin && withinLimit(organization.plan, 'projects', own.length),
      project_limit: planLimit(organization.plan, 'projects'),
      projects: own.map((project) => {
        const status = statusByProject.get(project.id)
        const open = incidentsByProject.get(project.id)
        return {
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description,
          visibility: project.visibility,
          status_page_url: projectStatusPageUrl(project, organization.slug),
          status: status?.worst ?? 'operational',
          components: status?.count ?? 0,
          open_incidents: open?.count ?? 0,
          worst_impact: open?.worst ?? null,
          created_at: project.created_at,
        }
      }),
    }
  })
}

// ------------------------------------------------------------------ status summary (GET /projects/{project}/status)
export async function getProjectStatus(ctx: DomainContext, projectRef: string): Promise<ProjectStatusResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const projectId = access.project.id
  const [componentsResult, groupsResult, incidentsResult, maintenancesResult] = await Promise.all([
    ctx.db.from('components').select('id, slug, name, status, group_id, position').eq('project_id', projectId).order('position').order('name'),
    ctx.db.from('component_groups').select('id, position, name').eq('project_id', projectId).order('position').order('name'),
    ctx.db
      .from('incidents')
      .select('id, title, status, impact, detected_at')
      .eq('project_id', projectId)
      .in('status', [...ACTIVE_INCIDENT_STATUSES])
      .is('deleted_at', null)
      .order('detected_at', { ascending: false }),
    ctx.db
      .from('maintenances')
      .select('id, title, status, scheduled_start, scheduled_end')
      .eq('project_id', projectId)
      .in('status', ['scheduled', 'in_progress'])
      .order('scheduled_start', { ascending: true })
      .limit(20),
  ])
  const components = unwrap(componentsResult) as Array<{ id: string; slug: string; name: string; status: ComponentStatus; group_id: string | null; position: number }>
  const groups = unwrap(groupsResult) as Array<{ id: string; position: number; name: string }>
  const groupIndex = new Map(groups.map((group, index) => [group.id, index]))
  const ordered = [...components].sort((a, b) => {
    const ga = a.group_id && groupIndex.has(a.group_id) ? groupIndex.get(a.group_id)! : Number.MAX_SAFE_INTEGER
    const gb = b.group_id && groupIndex.has(b.group_id) ? groupIndex.get(b.group_id)! : Number.MAX_SAFE_INTEGER
    return ga - gb || a.position - b.position || a.name.localeCompare(b.name)
  })
  const status: ComponentStatus = worstStatus(...components.map((component) => component.status)) ?? 'operational'
  const incidents = unwrap(incidentsResult) as Array<{ id: string; title: string; status: IncidentStatus; impact: IncidentImpact }>
  const maintenances = unwrap(maintenancesResult) as Array<{ id: string; title: string; status: MaintenanceStatus; scheduled_start: string; scheduled_end: string }>
  return {
    status,
    headline: OVERALL_STATUS_HEADLINES[status],
    components: ordered.map(({ id, slug, name, status: componentStatus }) => ({ id, slug, name, status: componentStatus })),
    active_incidents: incidents.map((incident) => ({
      id: incident.id,
      title: incident.title,
      status: incident.status,
      impact: incident.impact,
      url: projectStatusPageUrl(access.project, access.organization.slug, `/incidents/${incident.id}`),
    })),
    maintenances: maintenances
      .filter((maintenance) => maintenance.status === 'in_progress' || new Date(maintenance.scheduled_end).getTime() > Date.now())
      .map(({ id, title, status: maintenanceStatus, scheduled_start, scheduled_end }) => ({ id, title, status: maintenanceStatus, scheduled_start, scheduled_end })),
  }
}

/** Sorts statuses worst first (for callers that need a ranking). */
export function compareStatus(a: ComponentStatus, b: ComponentStatus): number {
  return statusRank(b) - statusRank(a)
}

// ------------------------------------------------------------------ writes
function settingsPatch(input: Omit<ProjectUpdateInput, 'name' | 'slug'>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const keys = ['description', 'visibility', 'timezone', 'support_url', 'theme_default', 'brand_color', 'logo_url', 'hide_powered_by', 'auto_postmortem', 'auto_draft_incidents', 'allowed_ips', 'custom_domain'] as const
  for (const key of keys) {
    if (input[key] !== undefined) patch[key] = input[key]
  }
  if (input.uptime_weights !== undefined) {
    patch.uptime_weights = { major_outage: 1, partial_outage: input.uptime_weights.partial_outage, degraded: input.uptime_weights.degraded }
  }
  return patch
}

/** A custom domain cannot be the app's own host (or one of its subdomains). */
function assertForeignDomain(domain: string | null | undefined): void {
  if (!domain) return
  const hosts = [env.appUrl(), env.apiHost() ?? ''].map((value) => {
    try {
      return value ? new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase() : ''
    } catch {
      return ''
    }
  })
  for (const host of hosts) {
    if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) continue
    if (domain === host || domain.endsWith(`.${host}`)) throw invalid('Use a domain you own, such as status.example.com.')
  }
}

async function takenSlugs(ctx: DomainContext, organizationId: string): Promise<string[]> {
  const rows = unwrap(await ctx.db.from('projects').select('slug').eq('organization_id', organizationId)) as Array<{ slug: string }>
  return rows.map((row) => row.slug)
}

async function readProject(ctx: DomainContext, projectId: string): Promise<ProjectRow> {
  return unwrapOne(await ctx.db.from('projects').select(PROJECT_COLUMNS).eq('id', projectId).maybeSingle(), 'Status page') as ProjectRow
}

/**
 * Creates a status page. Dashboard users pass `organization_id` and must be admins there; API keys must be
 * organization-wide (a key limited to one page cannot create others). The database applies the plan limits.
 */
export async function createProject(ctx: DomainContext, input: ProjectCreateInput): Promise<ProjectResource> {
  requireWriteScope(ctx)
  let organizationId: string
  let organizationSlug: string
  if (ctx.actor.type === 'api_key') {
    if (ctx.actor.projectId) throw forbidden('This API key is limited to one status page. Use an organization-wide key to create status pages.')
    if (input.organization_id && input.organization_id !== ctx.actor.organizationId) throw notFound('Organization')
    organizationId = ctx.actor.organizationId
    organizationSlug = ctx.actor.organizationSlug
  } else {
    if (!input.organization_id) throw invalid('Choose the organization for the new status page.', [{ path: 'organization_id', message: 'Choose an organization.' }])
    const { organization } = await requireOrganization(ctx, input.organization_id, 'admin')
    organizationId = organization.id
    organizationSlug = organization.slug
  }
  assertForeignDomain(input.custom_domain)

  const taken = await takenSlugs(ctx, organizationId)
  if (input.slug && taken.includes(input.slug)) throw conflict('Another status page in this organization already uses that slug.')
  const baseSlug = input.slug ?? slugifyProjectName(input.name)
  const settings = settingsPatch(input)

  // Insert without RETURNING: the SELECT policy cannot see a page inside the statement that creates it.
  let projectId: string | null = null
  let slug = input.slug ?? uniqueProjectSlug(baseSlug, taken)
  for (let attempt = 0; attempt < 3 && !projectId; attempt++) {
    const id = crypto.randomUUID()
    const { error } = await ctx.db.from('projects').insert({
      id,
      organization_id: organizationId,
      name: input.name,
      slug,
      ...settings,
      ...(ctx.actor.type === 'user' ? { user_id: ctx.actor.id } : {}),
    })
    if (!error) {
      projectId = id
      break
    }
    // Two pages created at once with the same generated slug: take the next one and retry.
    if (error.code === '23505' && !input.slug && /slug/.test(`${error.message} ${error.details ?? ''}`)) {
      slug = uniqueProjectSlug(baseSlug, [...taken, slug, ...(await takenSlugs(ctx, organizationId))])
      continue
    }
    if (error.code === '23505' && /slug/.test(`${error.message} ${error.details ?? ''}`)) throw conflict('Another status page in this organization already uses that slug.')
    throw fromDatabaseError(error, 'Status page')
  }
  if (!projectId) throw conflict('Could not find a free slug. Choose one yourself.')

  const row = await readProject(ctx, projectId)
  await audit(ctx, {
    organizationId,
    projectId,
    action: 'project.created',
    targetType: 'project',
    targetId: projectId,
    metadata: { name: row.name, slug: row.slug, visibility: row.visibility },
  })
  return toProjectResource(row, organizationSlug)
}

/** Changes status page settings (admin). Plan gates (private pages, branding, custom domains) live in the database. */
export async function updateProject(ctx: DomainContext, projectRef: string, input: ProjectUpdateInput): Promise<ProjectResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = access.project
  const patch: Record<string, unknown> = settingsPatch(input)
  if (input.name !== undefined && input.name !== current.name) patch.name = input.name
  if (input.slug !== undefined && input.slug !== current.slug) {
    const taken = await takenSlugs(ctx, current.organization_id)
    if (taken.includes(input.slug)) throw conflict('Another status page in this organization already uses that slug.')
    patch.slug = input.slug
  }
  if ('custom_domain' in patch) {
    if (patch.custom_domain === current.custom_domain) delete patch.custom_domain
    else assertForeignDomain(patch.custom_domain as string | null)
  }
  if (Object.keys(patch).length === 0) return toProjectResource(current, access.organization.slug)

  const { error } = await ctx.db.from('projects').update(patch).eq('id', current.id)
  if (error) {
    if (error.code === '23505' && /slug/.test(`${error.message} ${error.details ?? ''}`)) throw conflict('Another status page in this organization already uses that slug.')
    throw fromDatabaseError(error, 'Status page')
  }
  const row = await readProject(ctx, current.id)
  const metadata: Record<string, unknown> = { changes: Object.keys(patch) }
  if ('visibility' in patch) metadata.visibility = row.visibility
  if ('custom_domain' in patch) metadata.custom_domain = row.custom_domain
  if ('slug' in patch) metadata.slug = { from: current.slug, to: row.slug }
  await audit(ctx, { organizationId: access.organization.id, projectId: current.id, action: 'project.updated', targetType: 'project', targetId: current.id, metadata })
  touchStatusPage(access.organization.slug, current.slug, row.slug)
  return toProjectResource(row, access.organization.slug)
}

/** Deletes a status page with everything in it (admin). */
export async function deleteProject(ctx: DomainContext, projectRef: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const deleted = unwrap(await ctx.db.from('projects').delete().eq('id', access.project.id).select('id')) as Array<{ id: string }>
  if (deleted.length === 0) throw notFound('Status page')
  // The audit row outlives the page (audit_logs.project_id would point at a deleted row).
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: null,
    action: 'project.deleted',
    targetType: 'project',
    targetId: access.project.id,
    metadata: { name: access.project.name, slug: access.project.slug },
  })
  touchStatusPage(access.organization.slug, access.project.slug)
}

/** Resolves access for callers that already did requireProject (keeps page code short). */
export type { ProjectAccess }

export function isPlanError(error: unknown): boolean {
  return error instanceof DomainError && (error.code === 'plan_limit' || error.code === 'plan_required')
}
