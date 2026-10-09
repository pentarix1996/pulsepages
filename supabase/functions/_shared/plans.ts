// Plan limits. Mirror of SQL public.plan_limit() in supabase/migrations/20261009120000_v2_organizations.sql.
// The database enforces them; this file only explains them in the UI and the API. -1 means unlimited.

export const PLANS = ['free', 'pro', 'business'] as const
export type Plan = (typeof PLANS)[number]

export const PLAN_LIMIT_KEYS = [
  'projects',
  'components_per_project',
  'monitors',
  'min_interval_seconds',
  'regions_per_monitor',
  'subscribers_per_project',
  'history_days',
  'members',
  'api',
  'custom_domain',
  'private_pages',
  'paging_channels',
  'sso',
] as const
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number]

const LIMITS: Record<Plan, Record<PlanLimitKey, number>> = {
  free: {
    projects: 1,
    components_per_project: 10,
    monitors: 5,
    min_interval_seconds: 180,
    regions_per_monitor: 1,
    subscribers_per_project: 100,
    history_days: 7,
    members: 3,
    api: 0,
    custom_domain: 0,
    private_pages: 0,
    paging_channels: 0,
    sso: 0,
  },
  pro: {
    projects: 5,
    components_per_project: 50,
    monitors: 30,
    min_interval_seconds: 60,
    regions_per_monitor: 3,
    subscribers_per_project: 2000,
    history_days: 90,
    members: 10,
    api: 1,
    custom_domain: 1,
    private_pages: 0,
    paging_channels: 0,
    sso: 0,
  },
  business: {
    projects: -1,
    components_per_project: -1,
    monitors: 100,
    min_interval_seconds: 30,
    regions_per_monitor: -1,
    subscribers_per_project: -1,
    history_days: 365,
    members: -1,
    api: 1,
    custom_domain: 1,
    private_pages: 1,
    paging_channels: 1,
    sso: 1,
  },
}

export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value)
}

export function planLimit(plan: string | null | undefined, key: PlanLimitKey): number {
  const resolved: Plan = isPlan(plan) ? plan : 'free'
  return LIMITS[resolved][key]
}

export function planAllows(plan: string | null | undefined, feature: 'api' | 'custom_domain' | 'private_pages' | 'paging_channels' | 'sso'): boolean {
  return planLimit(plan, feature) === 1
}

/** True when `count` more items still fit. Unlimited (-1) always fits. */
export function withinLimit(plan: string | null | undefined, key: PlanLimitKey, currentCount: number, adding = 1): boolean {
  const limit = planLimit(plan, key)
  return limit === -1 || currentCount + adding <= limit
}

export function formatLimit(value: number, unit?: string): string {
  if (value === -1) return 'Unlimited'
  return unit ? `${value.toLocaleString('en-US')} ${unit}` : value.toLocaleString('en-US')
}

/** Rate limit for the public API, per key and minute. */
export function apiRateLimitPerMinute(plan: string | null | undefined): number {
  return plan === 'business' ? 1200 : 600
}

/** Minimum plan that unlocks a feature, for upgrade prompts. */
export function planFor(feature: 'api' | 'custom_domain' | 'branding' | 'private_pages' | 'paging_channels' | 'sso'): Plan {
  return feature === 'private_pages' || feature === 'paging_channels' || feature === 'sso' ? 'business' : 'pro'
}

export interface PlanInfo {
  id: Plan
  name: string
  monthly: number
  yearly: number
  summary: string
  highlights: string[]
}

/** Display data for pricing and billing. Prices in USD; yearly is the per-month price when billed yearly. */
export const PLAN_INFO: Record<Plan, PlanInfo> = {
  free: {
    id: 'free',
    name: 'Free',
    monthly: 0,
    yearly: 0,
    summary: 'For side projects and trying Upvane.',
    highlights: [
      '1 status page, 10 components',
      '5 monitors every 3 minutes from 1 region',
      'Email, Slack, Teams, Discord and webhook alerts',
      '100 subscribers, 7 days of history',
      '3 team members',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthly: 9,
    yearly: 7,
    summary: 'For teams that run production services.',
    highlights: [
      '5 status pages, 50 components each',
      '30 monitors every 60 seconds from 3 regions',
      'API, Terraform provider, CLI and GitHub Action',
      'Custom domain and branding',
      '2,000 subscribers, 90 days of history',
      '10 team members',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    monthly: 29,
    yearly: 24,
    summary: 'For on-call teams with paging and compliance needs.',
    highlights: [
      'Unlimited status pages and components',
      '100 monitors every 30 seconds from every region',
      'PagerDuty and Opsgenie',
      'Private pages with SSO, IP allow-lists and access links',
      'Unlimited subscribers, 365 days of history',
      'Unlimited members, SSO and audit log export',
    ],
  },
}
