const MONITOR_EVENT_TYPE = {
  COMPONENT_RECOVERED: "component_recovered",
  COMPONENT_STATUS_WORSENED: "component_status_worsened",
} as const;

type MonitorEventType = (typeof MONITOR_EVENT_TYPE)[keyof typeof MONITOR_EVENT_TYPE];

interface MonitorAlertProjectProfile {
  username?: string | null;
}

interface MonitorAlertProject {
  name?: string | null;
  slug?: string | null;
  profiles?: MonitorAlertProjectProfile | null;
}

interface MonitorAlertComponent {
  id?: unknown;
  name?: unknown;
  projects?: MonitorAlertProject | null;
}

interface MonitorAlertConfig {
  id?: unknown;
  project_id?: unknown;
  component_id?: unknown;
}

interface MonitorAlertResult {
  checkStatus: string;
  resultingStatus: string;
  httpStatus: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
}

export interface MonitorTransitionAlertInput {
  config: MonitorAlertConfig;
  component: MonitorAlertComponent;
  previousStatus: string;
  result: MonitorAlertResult;
  checkedAt: string;
}

interface MonitorTransitionAlertPayloadComponent {
  id: string;
  name: string;
  previous_status: string;
  current_status: string;
}

interface MonitorTransitionAlertPayloadMonitor {
  status: string;
  http_status: number | null;
  response_time_ms: number;
  error_message: string | null;
  checked_at: string;
}

interface MonitorTransitionAlertPayload {
  project_id: string;
  project_name: string;
  event_type: MonitorEventType;
  status: string;
  severity: string;
  reason: string;
  occurred_at: string;
  dashboard_url: null;
  status_page_url: string | null;
  component: MonitorTransitionAlertPayloadComponent;
  incident: null;
  monitor: MonitorTransitionAlertPayloadMonitor;
}

export interface MonitorTransitionAlertEventRow {
  project_id: string;
  type: MonitorEventType;
  source_type: "monitor_edge_runner";
  source_id: string;
  severity: string;
  dedupe_key: string;
  payload: MonitorTransitionAlertPayload;
}

export function buildMonitorTransitionAlertEvent(input: MonitorTransitionAlertInput): MonitorTransitionAlertEventRow | null {
  const type = getTransitionEventType(input.previousStatus, input.result.resultingStatus);
  if (!type) return null;

  const project = input.component.projects ?? undefined;
  const profiles = project?.profiles ?? undefined;
  const projectId = String(input.config.project_id);
  const componentId = String(input.config.component_id);
  const componentName = String(input.component.name ?? "Component");
  const dedupeStatus = type === MONITOR_EVENT_TYPE.COMPONENT_RECOVERED ? "recovered" : input.result.resultingStatus;

  return {
    project_id: projectId,
    type,
    source_type: "monitor_edge_runner",
    source_id: String(input.config.id),
    severity: input.result.resultingStatus,
    dedupe_key: `${projectId}:${type}:component:${componentId}:${dedupeStatus}`,
    payload: {
      project_id: projectId,
      project_name: String(project?.name ?? "Upvane project"),
      event_type: type,
      status: input.result.resultingStatus,
      severity: input.result.resultingStatus,
      reason: input.result.errorMessage ?? `Monitor check changed ${componentName} to ${input.result.resultingStatus}.`,
      occurred_at: input.checkedAt,
      dashboard_url: null,
      status_page_url: profiles?.username && project?.slug ? `/status/${profiles.username}/${project.slug}` : null,
      component: {
        id: componentId,
        name: componentName,
        previous_status: input.previousStatus,
        current_status: input.result.resultingStatus,
      },
      incident: null,
      monitor: {
        status: input.result.checkStatus,
        http_status: input.result.httpStatus,
        response_time_ms: input.result.responseTimeMs,
        error_message: input.result.errorMessage,
        checked_at: input.checkedAt,
      },
    },
  };
}

function getTransitionEventType(previousStatus: string, currentStatus: string): MonitorEventType | null {
  if (currentStatus === "operational" && previousStatus !== "operational") return MONITOR_EVENT_TYPE.COMPONENT_RECOVERED;
  if (currentStatus !== "operational" && statusRank(currentStatus) > statusRank(previousStatus)) return MONITOR_EVENT_TYPE.COMPONENT_STATUS_WORSENED;
  return null;
}

function statusRank(status: string): number {
  if (status === "major_outage") return 3;
  if (status === "partial_outage") return 2;
  if (status === "degraded") return 1;
  return 0;
}
