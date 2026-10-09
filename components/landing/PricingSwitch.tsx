'use client'

import { useState, type ReactNode } from 'react'
import type { BillingPeriod } from './pricing'

/**
 * Monthly/yearly toggle. The plan cards are rendered on the server with both prices; this island only flips
 * `data-period`, and CSS shows the matching price (monthly is the default without JavaScript).
 */
export function PricingSwitch({ heading, yearlyHint, children }: { heading: ReactNode; yearlyHint: string | null; children: ReactNode }) {
  const [period, setPeriod] = useState<BillingPeriod>('monthly')
  return (
    <div className="lp-pricing" data-period={period}>
      <div className="lp-pricing-h">
        {heading}
        <div className="lp-seg" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={period === 'monthly'} onClick={() => setPeriod('monthly')}>
            Monthly
          </button>
          <button type="button" aria-pressed={period === 'yearly'} onClick={() => setPeriod('yearly')}>
            Yearly
            {yearlyHint ? <span className="lp-seg-hint">{yearlyHint}</span> : null}
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}
