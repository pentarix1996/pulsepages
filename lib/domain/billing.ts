import 'server-only'
import { PLAN_INFO, PLANS, planAllows, planLimit, type Plan } from '@shared/plans.ts'
import { env } from '@/lib/env'
import { requireDashboardUser, requireOrganization } from './access'
import { invalidateStatusPage } from './cache'
import type { DomainContext } from './context'
import { DomainError, fromDatabaseError } from './errors'
import type { PlanChangeInput, PlanUsage } from './schemas/organizations'

/** BILLING_MODE is not `demo` (Stripe is not wired yet): the route answers 501. */
export class BillingNotConfiguredError extends DomainError {
  constructor() {
    super('unavailable', 'Billing is not configured.')
    this.name = 'BillingNotConfiguredError'
  }
}

export function planRank(plan: Plan): number {
  return PLANS.indexOf(plan)
}

const EMPTY_USAGE: PlanUsage = {
  status_pages: 0,
  monitors_total: 0,
  monitors_active: 0,
  monitors_paused_by_plan: 0,
  monitors_interval_below: { '60': 0, '180': 0 },
  monitors_regions_above: { '1': 0, '3': 0 },
  members: 0,
  pending_invitations: 0,
  largest_page: null,
  custom_domains: 0,
  private_pages: 0,
  paging_channels: 0,
  api_keys_active: 0,
}

/** What the organization uses, compared with plan limits on the billing page. Any member can read it. */
export async function getPlanUsage(ctx: DomainContext, organizationId: string): Promise<PlanUsage> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, organizationId, 'viewer')
  const { data, error } = await ctx.db.rpc('organization_usage', { p_organization_id: access.organization.id })
  if (error) throw fromDatabaseError(error, 'Organization')
  return { ...EMPTY_USAGE, ...((data ?? {}) as Partial<PlanUsage>) }
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`
}

/**
 * Plain-language consequences of moving from `from` to `to` with the current usage. Mirrors what
 * enforce_plan_limits() and the plan checks in SQL do, so the confirm dialog says what will be paused.
 */
export function planChangeEffects(usage: PlanUsage, from: Plan, to: Plan): string[] {
  if (from === to) return []
  const effects: string[] = []
  if (planRank(to) > planRank(from)) {
    if (usage.monitors_paused_by_plan > 0) effects.push(`${plural(usage.monitors_paused_by_plan, 'monitor')} paused by the plan limit resume checking.`)
    effects.push(`Limits rise to the ${PLAN_INFO[to].name} plan right away.`)
    return effects
  }

  const monitorLimit = planLimit(to, 'monitors')
  if (monitorLimit !== -1 && usage.monitors_active > monitorLimit) {
    const paused = usage.monitors_active - monitorLimit
    effects.push(`${plural(paused, 'monitor')} of your ${usage.monitors_active} active ones will pause, newest first. They resume when you upgrade again.`)
  }
  const minInterval = planLimit(to, 'min_interval_seconds')
  const faster = minInterval === 60 ? usage.monitors_interval_below['60'] : minInterval === 180 ? usage.monitors_interval_below['180'] : 0
  if (faster > 0) effects.push(`${plural(faster, 'monitor')} will check every ${minInterval} seconds instead of more often.`)
  const maxRegions = planLimit(to, 'regions_per_monitor')
  const wider = maxRegions === 1 ? usage.monitors_regions_above['1'] : maxRegions === 3 ? usage.monitors_regions_above['3'] : 0
  if (wider > 0) effects.push(`${plural(wider, 'monitor')} will keep only ${plural(maxRegions, 'region')}.`)
  if (!planAllows(to, 'api') && usage.api_keys_active > 0) effects.push(`${plural(usage.api_keys_active, 'API key')} stop working until you upgrade again.`)
  if (!planAllows(to, 'custom_domain') && usage.custom_domains > 0) effects.push('Custom domains are suspended and status pages show the Upvane badge again.')
  if (!planAllows(to, 'paging_channels') && usage.paging_channels > 0) effects.push('PagerDuty and Opsgenie channels stop receiving alerts.')
  if (!planAllows(to, 'private_pages') && usage.private_pages > 0) effects.push('Private status pages stay private, but you cannot make other pages private.')

  const pageLimit = planLimit(to, 'projects')
  if (pageLimit !== -1 && usage.status_pages > pageLimit) {
    effects.push(`You have ${plural(usage.status_pages, 'status page')} and ${PLAN_INFO[to].name} includes ${pageLimit}. They keep working, but you cannot add more.`)
  }
  const memberLimit = planLimit(to, 'members')
  if (memberLimit !== -1 && usage.members > memberLimit) {
    effects.push(`You have ${plural(usage.members, 'member')} and ${PLAN_INFO[to].name} includes ${memberLimit}. Nobody loses access, but you cannot invite more people.`)
  }
  const subscriberLimit = planLimit(to, 'subscribers_per_project')
  if (subscriberLimit !== -1 && usage.largest_page && usage.largest_page.subscribers > subscriberLimit) {
    effects.push(`${usage.largest_page.name} has ${plural(usage.largest_page.subscribers, 'subscriber')}; new sign-ups stop above ${subscriberLimit.toLocaleString('en-US')}.`)
  }
  const history = planLimit(to, 'history_days')
  if (history < planLimit(from, 'history_days')) effects.push(`Status pages show the last ${history} days of history.`)
  return effects
}

export interface PlanChangeResult {
  plan: Plan
  previous_plan: Plan
  changed: boolean
  paused_monitors: number
  resumed_monitors: number
}

/**
 * Changes the organization's plan (C-4: users cannot write organizations.plan themselves). Owners only. With
 * BILLING_MODE=demo the plan is written with the service role; the database pauses monitors, clamps limits and
 * records billing.plan_changed with the owner as actor.
 */
export async function changePlan(ctx: DomainContext, input: PlanChangeInput): Promise<PlanChangeResult> {
  requireDashboardUser(ctx)
  const access = await requireOrganization(ctx, input.organization_id, 'owner')
  if (env.billingMode() !== 'demo') throw new BillingNotConfiguredError()

  const { data, error } = await ctx.admin().rpc('change_organization_plan', {
    p_organization_id: access.organization.id,
    p_plan: input.plan,
    p_actor_id: ctx.actor.id,
    p_actor_label: ctx.actor.label,
    p_ip: ctx.ip,
    p_metadata: { request_id: ctx.requestId, interval: input.interval, billing_mode: 'demo' },
  })
  if (error) throw fromDatabaseError(error, 'Organization')
  const result = data as PlanChangeResult

  if (result.changed) {
    // History length, badges and custom domains on public pages depend on the plan.
    const { data: projects } = await ctx.admin().from('projects').select('slug').eq('organization_id', access.organization.id)
    for (const project of (projects ?? []) as Array<{ slug: string }>) invalidateStatusPage(access.organization.slug, project.slug)
  }
  return result
}
