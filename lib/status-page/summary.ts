// /api/v2/summary.json and /api/v2/status.json in the shape of Atlassian Statuspage, so existing widgets, bots and
// migration tools can read an Upvane page unchanged. Pure.
import { OVERALL_STATUS_HEADLINES, worstStatus, type ComponentStatus, type IncidentStatus, type MaintenanceStatus } from '@shared/domain.ts'
import { PAGE_PATHS, pageUrl, type PageLocation } from './links'
import type { StatusIncident, StatusMaintenance, StatusPageData } from './types'
import { componentSections } from './view'

export type AtlassianIndicator = 'none' | 'minor' | 'major' | 'critical' | 'maintenance'
export type AtlassianComponentStatus = 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage' | 'under_maintenance'

export const ATLASSIAN_COMPONENT_STATUS: Record<ComponentStatus, AtlassianComponentStatus> = {
  operational: 'operational',
  degraded: 'degraded_performance',
  partial_outage: 'partial_outage',
  major_outage: 'major_outage',
  maintenance: 'under_maintenance',
}

export const ATLASSIAN_INDICATOR: Record<ComponentStatus, AtlassianIndicator> = {
  operational: 'none',
  degraded: 'minor',
  partial_outage: 'major',
  major_outage: 'critical',
  maintenance: 'maintenance',
}

const MAINTENANCE_STATUS: Record<MaintenanceStatus, string> = {
  scheduled: 'scheduled',
  in_progress: 'in_progress',
  completed: 'completed',
  cancelled: 'completed',
}

export function atlassianComponentStatus(status: ComponentStatus): AtlassianComponentStatus {
  return ATLASSIAN_COMPONENT_STATUS[status] ?? 'operational'
}

export function atlassianStatus(overall: ComponentStatus): { indicator: AtlassianIndicator; description: string } {
  return { indicator: ATLASSIAN_INDICATOR[overall] ?? 'none', description: OVERALL_STATUS_HEADLINES[overall] ?? OVERALL_STATUS_HEADLINES.operational }
}

export interface SummaryContext {
  location: PageLocation
  appUrl: string
}

function pageObject(page: StatusPageData, context: SummaryContext) {
  return {
    id: page.project.id,
    name: page.project.name,
    url: pageUrl(context.location, context.appUrl),
    time_zone: page.project.timezone,
    updated_at: page.generated_at,
  }
}

function firstAt<T extends { status: string; created_at: string }>(updates: T[], status: string): string | null {
  const matching = updates.filter((update) => update.status === status).map((update) => update.created_at)
  return matching.length ? matching.sort()[0]! : null
}

function incidentObject(incident: StatusIncident, page: StatusPageData, context: SummaryContext, names: Map<string, string>) {
  const latestUpdate = incident.updates[0]?.created_at ?? incident.started_at
  return {
    id: incident.id,
    name: incident.title,
    status: incident.status as IncidentStatus,
    impact: incident.impact,
    created_at: incident.started_at,
    updated_at: latestUpdate,
    started_at: incident.started_at,
    monitoring_at: firstAt(incident.updates, 'monitoring'),
    resolved_at: incident.resolved_at,
    shortlink: pageUrl(context.location, context.appUrl, PAGE_PATHS.incident(incident.id)),
    page_id: page.project.id,
    incident_updates: incident.updates.map((update) => ({
      id: update.id,
      status: update.status,
      body: update.message,
      incident_id: incident.id,
      created_at: update.created_at,
      updated_at: update.created_at,
      display_at: update.created_at,
      affected_components: Object.entries(update.components ?? {})
        .filter(([id]) => names.has(id))
        .map(([id, status]) => ({ code: id, name: names.get(id)!, new_status: atlassianComponentStatus(status) })),
    })),
    components: incident.components.map((component) => ({ id: component.id, name: component.name, status: atlassianComponentStatus(component.status) })),
  }
}

function maintenanceObject(maintenance: StatusMaintenance, page: StatusPageData, context: SummaryContext) {
  const announced = maintenance.updates[maintenance.updates.length - 1]?.created_at ?? maintenance.scheduled_start
  return {
    id: maintenance.id,
    name: maintenance.title,
    status: MAINTENANCE_STATUS[maintenance.status] ?? maintenance.status,
    impact: 'maintenance',
    created_at: announced,
    updated_at: maintenance.updates[0]?.created_at ?? announced,
    started_at: maintenance.actual_start ?? maintenance.scheduled_start,
    monitoring_at: null,
    resolved_at: maintenance.actual_end,
    scheduled_for: maintenance.scheduled_start,
    scheduled_until: maintenance.scheduled_end,
    shortlink: pageUrl(context.location, context.appUrl, PAGE_PATHS.maintenance(maintenance.id)),
    page_id: page.project.id,
    incident_updates: maintenance.updates.map((update) => ({
      id: update.id,
      status: update.status,
      body: update.message,
      incident_id: maintenance.id,
      created_at: update.created_at,
      updated_at: update.created_at,
      display_at: update.created_at,
    })),
    components: maintenance.components.map((component) => {
      const current = page.components.find((candidate) => candidate.id === component.id)
      return { id: component.id, name: component.name, status: atlassianComponentStatus(current?.status ?? 'operational') }
    }),
  }
}

/** Groups appear as components with `group: true` and the ids of their members, as on Statuspage. */
function componentObjects(page: StatusPageData) {
  const out: Array<Record<string, unknown>> = []
  for (const section of componentSections(page)) {
    if (section.group) {
      out.push({
        id: section.group.id,
        name: section.group.name,
        status: atlassianComponentStatus(worstStatus(...section.components.map((component) => component.status)) ?? 'operational'),
        description: null,
        position: section.group.position,
        group_id: null,
        page_id: page.project.id,
        group: true,
        showcase: false,
        only_show_if_degraded: false,
        components: section.components.map((component) => component.id),
      })
    }
    for (const component of section.components) {
      out.push({
        id: component.id,
        name: component.name,
        status: atlassianComponentStatus(component.status),
        description: component.description,
        position: component.position,
        group_id: section.group?.id ?? null,
        page_id: page.project.id,
        group: false,
        showcase: true,
        only_show_if_degraded: false,
      })
    }
  }
  return out
}

export function buildStatusJson(page: StatusPageData, context: SummaryContext) {
  return { page: pageObject(page, context), status: atlassianStatus(page.overall_status) }
}

export function buildSummaryJson(page: StatusPageData, context: SummaryContext) {
  const names = new Map(page.components.map((component) => [component.id, component.name]))
  return {
    page: pageObject(page, context),
    status: atlassianStatus(page.overall_status),
    components: componentObjects(page),
    incidents: page.active_incidents.filter((incident) => incident.status !== 'resolved').map((incident) => incidentObject(incident, page, context, names)),
    scheduled_maintenances: page.maintenances
      .filter((maintenance) => maintenance.status === 'scheduled' || maintenance.status === 'in_progress')
      .map((maintenance) => maintenanceObject(maintenance, page, context)),
  }
}
