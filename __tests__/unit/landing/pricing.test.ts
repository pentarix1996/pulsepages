import { describe, expect, it } from 'vitest'
import { PLAN_INFO } from '@shared/plans.ts'
import { formatUsd, maxYearlyDiscountPercent, planPrice, planSignupHref, yearlyDiscountPercent, yearlySavings, yearlyTotal } from '@/components/landing/pricing'

describe('planPrice', () => {
  it('shows monthly prices from PLAN_INFO', () => {
    expect(planPrice('pro', 'monthly')).toEqual({ amount: `$${PLAN_INFO.pro.monthly}`, per: 'per month', note: 'Billed monthly' })
    expect(planPrice('business', 'monthly').amount).toBe(`$${PLAN_INFO.business.monthly}`)
  })

  it('shows the per-month price billed yearly, with the yearly total and the saving', () => {
    expect(planPrice('pro', 'yearly')).toEqual({ amount: '$7', per: 'per month, billed yearly', note: '$84 billed once a year · save $24' })
    expect(planPrice('business', 'yearly')).toEqual({ amount: '$24', per: 'per month, billed yearly', note: '$288 billed once a year · save $60' })
  })

  it('keeps the free plan at zero in both periods', () => {
    expect(planPrice('free', 'monthly')).toEqual({ amount: '$0', per: 'forever', note: 'No card needed' })
    expect(planPrice('free', 'yearly')).toEqual(planPrice('free', 'monthly'))
  })
})

describe('yearly math', () => {
  it('derives totals and savings from the per-month prices', () => {
    expect(yearlyTotal('pro')).toBe(PLAN_INFO.pro.yearly * 12)
    expect(yearlySavings('pro')).toBe((PLAN_INFO.pro.monthly - PLAN_INFO.pro.yearly) * 12)
    expect(yearlySavings('free')).toBe(0)
  })

  it('rounds the discount down so the label never overstates it', () => {
    expect(yearlyDiscountPercent('pro')).toBe(22) // 2 / 9 = 22.2 %
    expect(yearlyDiscountPercent('business')).toBe(17) // 5 / 29 = 17.2 %
    expect(yearlyDiscountPercent('free')).toBe(0)
    expect(maxYearlyDiscountPercent()).toBe(22)
  })
})

describe('formatting and links', () => {
  it('formats dollars without needless decimals', () => {
    expect(formatUsd(9)).toBe('$9')
    expect(formatUsd(7.5)).toBe('$7.50')
    expect(formatUsd(1200)).toBe('$1,200')
  })

  it('sends each plan to sign-up', () => {
    expect(planSignupHref('free')).toBe('/register')
    expect(planSignupHref('business')).toBe('/register?plan=business')
  })
})
