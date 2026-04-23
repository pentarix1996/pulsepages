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
  plan: Plan
  created_at: string
}

export interface UserData {
  id: string
  email: string
  name: string
  plan: Plan
}

export interface ComponentStatusHistory {
  id: string
  component_id: string
  status: ComponentStatus
  changed_at: string
  reason: 'incident' | 'manual' | 'maintenance' | 'incident_resolved'
  incident_id: string | null
}
