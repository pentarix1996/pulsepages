import 'server-only'
import { ALERT_EVENT_TYPE, ALERT_SOURCE_TYPE, type AlertEventType, type AlertPayload, type AlertSourceType } from './types'
import type { ComponentStatus } from '@/lib/types'
import { publishAlertEvent } from './queue'

const STATUS_RANK: Record<ComponentStatus, number> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
  maintenance: 0,
}

interface EnqueueAlertInput {
  projectId: string
  type: AlertEventType
  sourceType: AlertSourceType
  sourceId: string | null
  severity: string | null
  dedupeKey: string
  payload: AlertPayload
}

interface TransitionAlertInput {
  projectId: string
  projectName: string
  componentId: string
  componentName: string
  previousStatus: ComponentStatus
  currentStatus: ComponentStatus
  sourceType: AlertSourceType
  sourceId: string | null
  reason: string
  monitor: AlertPayload['monitor']
  dashboardUrl: string | null
  statusPageUrl: string | null
}

export async function enqueueAlertEvent(input: EnqueueAlertInput): Promise<{ queued: boolean; error: string | null }> {
  try {
    const result = await publishAlertEvent(input)
    if (!result.queued) return { queued: false, error: result.error }
    return { queued: true, error: null }
  } catch (error) {
    return { queued: false, error: error instanceof Error ? error.message : 'Alert enqueue failed.' }
  }
}

export async function enqueueComponentTransitionAlert(input: TransitionAlertInput): Promise<{ queued: boolean; skipped: boolean; error: string | null }> {
  const eventType = getComponentTransitionEventType(input.previousStatus, input.currentStatus)
  if (!eventType) return { queued: false, skipped: true, error: null }
  const dedupeKey = createComponentDedupeKey(input.projectId, eventType, input.componentId, input.currentStatus)
  const payload: AlertPayload = {
    project_id: input.projectId,
    project_name: input.projectName,
    event_type: eventType,
    status: input.currentStatus,
    severity: input.currentStatus,
    reason: input.reason,
    occurred_at: new Date().toISOString(),
    dashboard_url: input.dashboardUrl,
    status_page_url: input.statusPageUrl,
    component: {
      id: input.componentId,
      name: input.componentName,
      previous_status: input.previousStatus,
      current_status: input.currentStatus,
    },
    incident: null,
    monitor: input.monitor,
  }
  const result = await enqueueAlertEvent({
    projectId: input.projectId,
    type: eventType,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    severity: input.currentStatus,
    dedupeKey,
    payload,
  })
  return { ...result, skipped: false }
}

export function getComponentTransitionEventType(previousStatus: ComponentStatus, currentStatus: ComponentStatus): AlertEventType | null {
  if (currentStatus === 'operational' && previousStatus !== 'operational') return ALERT_EVENT_TYPE.COMPONENT_RECOVERED
  if (currentStatus !== 'operational' && STATUS_RANK[currentStatus] > STATUS_RANK[previousStatus]) return ALERT_EVENT_TYPE.COMPONENT_STATUS_WORSENED
  return null
}

export function createComponentDedupeKey(projectId: string, type: AlertEventType, componentId: string, status: ComponentStatus): string {
  const statusPart = type === ALERT_EVENT_TYPE.COMPONENT_RECOVERED ? 'recovered' : status
  return `${projectId}:${type}:component:${componentId}:${statusPart}`
}

export function createIncidentDedupeKey(projectId: string, type: AlertEventType, incidentId: string, status: string): string {
  return `${projectId}:${type}:incident:${incidentId}:${status}`
}

export { ALERT_EVENT_TYPE, ALERT_SOURCE_TYPE }
