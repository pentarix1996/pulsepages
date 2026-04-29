export type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance'
export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'maintenance'
export type Plan = 'free' | 'pro' | 'business'

export interface Component {
  id: string
  project_id: string
  name: string
  status: ComponentStatus
  created_at?: string
}

export interface Project {
  id: string
  user_id: string
  name: string
  slug: string
  description: string | null
  components: Component[]
  profiles?: { username: string }
  created_at: string
  updated_at: string
}

export interface IncidentUpdate {
  id: string
  incident_id: string
  message: string
  status: string
  created_at: string
}

export interface Incident {
  id: string
  project_id: string
  title: string
  description: string | null
  status: IncidentStatus
  severity: IncidentSeverity
  component_ids: string[]
  duration: number
  created_at: string
  incident_updates: IncidentUpdate[]
}

export interface Profile {
  id: string
  name: string
  username: string
  plan: Plan
  created_at: string
}

export interface UserData {
  id: string
  email: string
  name: string
  username: string
  plan: Plan
}

export interface ComponentStatusHistory {
  id: string
  component_id: string
  status: ComponentStatus
  changed_at: string
  reason: 'incident' | 'manual' | 'maintenance' | 'incident_resolved' | 'monitor' | 'monitor_recovery'
  incident_id: string | null
}

export interface ComponentMonitorConfig {
  id: string
  project_id: string
  component_id: string
  mode: 'manual' | 'automatic'
  enabled: boolean
  url: string | null
  method: 'GET' | 'HEAD'
  interval_seconds: number
  timeout_ms: number
  expected_status_codes: number[]
  response_type: 'none' | 'json'
  json_rules: unknown[]
  failure_status: ComponentStatus
  no_match_status: ComponentStatus
  last_checked_at: string | null
  next_check_at: string | null
  created_at: string
  updated_at: string
}

export interface MonitorCheckResult {
  id: string
  config_id: string
  project_id: string
  component_id: string
  status: 'success' | 'failure'
  resulting_status: ComponentStatus | null
  http_status: number | null
  response_time_ms: number | null
  error_message: string | null
  checked_at: string
}

export interface ApiKey {
  id: string
  user_id: string
  project_id: string
  token_hash: string
  name: string
  created_at: string
}
