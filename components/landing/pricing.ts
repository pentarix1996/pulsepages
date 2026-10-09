// Pricing display math for the landing. Prices come from PLAN_INFO (USD); `yearly` is the per-month price when
// billed yearly.
import { PLAN_INFO, PLANS, type Plan } from '@shared/plans.ts'

export type BillingPeriod = 'monthly' | 'yearly'

export interface PlanPrice {
  /** Big number on the card, e.g. "$7". */
  amount: string
  /** Text next to the amount, e.g. "per month, billed yearly". */
  per: string
  /** Line under the price, e.g. "$84 billed once a year · save $24". Always present so cards keep their height. */
  note: string
}

export function formatUsd(value: number): string {
  const rounded = Math.round(value * 100) / 100
  const text = Number.isInteger(rounded) ? rounded.toLocaleString('en-US') : rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `$${text}`
}

export function isFreePlan(plan: Plan): boolean {
  const info = PLAN_INFO[plan]
  return info.monthly === 0 && info.yearly === 0
}

/** What a year costs when billed yearly. */
export function yearlyTotal(plan: Plan): number {
  return PLAN_INFO[plan].yearly * 12
}

/** What yearly billing saves over twelve monthly payments. Never negative. */
export function yearlySavings(plan: Plan): number {
  const info = PLAN_INFO[plan]
  return Math.max(0, (info.monthly - info.yearly) * 12)
}

/** Discount of yearly billing as a whole percentage, rounded down so the claim is never overstated. */
export function yearlyDiscountPercent(plan: Plan): number {
  const info = PLAN_INFO[plan]
  if (info.monthly <= 0) return 0
  return Math.max(0, Math.floor(((info.monthly - info.yearly) / info.monthly) * 100))
}

/** Largest yearly discount across plans, for the "save up to" label on the toggle. */
export function maxYearlyDiscountPercent(plans: readonly Plan[] = PLANS): number {
  return plans.reduce((max, plan) => Math.max(max, yearlyDiscountPercent(plan)), 0)
}

export function planPrice(plan: Plan, period: BillingPeriod): PlanPrice {
  const info = PLAN_INFO[plan]
  if (isFreePlan(plan)) return { amount: formatUsd(0), per: 'forever', note: 'No card needed' }
  if (period === 'monthly') return { amount: formatUsd(info.monthly), per: 'per month', note: 'Billed monthly' }
  const savings = yearlySavings(plan)
  const total = `${formatUsd(yearlyTotal(plan))} billed once a year`
  return {
    amount: formatUsd(info.yearly),
    per: 'per month, billed yearly',
    note: savings > 0 ? `${total} · save ${formatUsd(savings)}` : total,
  }
}

export const PLAN_CTA: Record<Plan, string> = { free: 'Start free', pro: 'Choose Pro', business: 'Choose Business' }

export function planSignupHref(plan: Plan): string {
  return plan === 'free' ? '/register' : `/register?plan=${plan}`
}
