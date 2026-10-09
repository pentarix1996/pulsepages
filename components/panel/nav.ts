import type { ComponentType } from 'react'
import {
  BellIcon,
  CalendarIcon,
  ChartIcon,
  IncidentIcon,
  LayersIcon,
  MonitorIcon,
  PlugIcon,
  PulseIcon,
  StatusPageIcon,
  type IconProps,
} from '@/components/ui/icons'

export interface ProjectNavItem {
  segment: string
  label: string
  icon: ComponentType<IconProps>
  count?: 'incidents' | 'monitors'
}

/** Project sections, in sidebar order (spec §10). */
export const PROJECT_NAV: ProjectNavItem[] = [
  { segment: 'overview', label: 'Overview', icon: PulseIcon },
  { segment: 'incidents', label: 'Incidents', icon: IncidentIcon, count: 'incidents' },
  { segment: 'monitors', label: 'Monitors', icon: MonitorIcon, count: 'monitors' },
  { segment: 'maintenance', label: 'Maintenance', icon: CalendarIcon },
  { segment: 'components', label: 'Components', icon: LayersIcon },
  { segment: 'alerts', label: 'Alerts and routing', icon: BellIcon },
  { segment: 'integrations', label: 'Integrations', icon: PlugIcon },
  { segment: 'status-page', label: 'Status page', icon: StatusPageIcon },
  { segment: 'reports', label: 'Reports', icon: ChartIcon },
]

export const SETTINGS_NAV = [
  { href: '/settings/account', label: 'Account' },
  { href: '/settings/security', label: 'Security' },
  { href: '/settings/organization', label: 'Organization' },
  { href: '/settings/members', label: 'Members' },
  { href: '/settings/api-keys', label: 'API keys' },
  { href: '/settings/billing', label: 'Plan and billing' },
  { href: '/settings/audit-log', label: 'Audit log' },
] as const

export function projectHref(projectId: string, segment = 'overview'): string {
  return `/p/${projectId}/${segment}`
}
