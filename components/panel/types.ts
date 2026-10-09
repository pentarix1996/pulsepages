import type { OrgRole } from '@shared/domain.ts'
import type { Plan } from '@shared/plans.ts'

export interface ShellProject {
  id: string
  name: string
  slug: string
  organization_id: string
  status_page_url: string
}

export interface ShellOrganization {
  id: string
  name: string
  slug: string
  plan: Plan
  personal: boolean
  role: OrgRole
}

export interface ShellUser {
  id: string
  name: string
  email: string | null
}

export interface ShellCounts {
  /** Active incidents per project. */
  incidents: Record<string, number>
  /** Monitors down or degraded per project. */
  monitors: Record<string, number>
}
