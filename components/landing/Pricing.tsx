import { PLAN_INFO, PLANS } from '@shared/plans.ts'
import { ButtonLink } from '@/components/ui/Button'
import { CheckIcon } from '@/components/ui/icons'
import { PricingSwitch } from './PricingSwitch'
import { PLAN_CTA, maxYearlyDiscountPercent, planPrice, planSignupHref, type BillingPeriod } from './pricing'

const FEATURED = 'pro'
const PERIODS: BillingPeriod[] = ['monthly', 'yearly']

export function Pricing() {
  const discount = maxYearlyDiscountPercent()
  return (
    <section id="pricing" className="lp-wrap lp-section" aria-labelledby="pricing-title">
      <PricingSwitch
        yearlyHint={discount > 0 ? `save up to ${discount}%` : null}
        heading={
          <div className="lp-intro">
            <h2 className="lp-h2" id="pricing-title">
              Start free, pay when it&apos;s production
            </h2>
            <p className="lp-lede">
              Every plan includes a status page, incidents, subscribers and alerts by email, Slack, Teams, Discord and webhook. Paid plans add faster checks from
              more regions, the API and your own domain.
            </p>
          </div>
        }
      >
        <div className="lp-plans">
          {PLANS.map((plan) => {
            const info = PLAN_INFO[plan]
            const featured = plan === FEATURED
            return (
              <article key={plan} className={featured ? 'lp-plan feat' : 'lp-plan'} aria-labelledby={`plan-${plan}`}>
                <div className="lp-plan-h">
                  <h3 id={`plan-${plan}`}>{info.name}</h3>
                  <p>{info.summary}</p>
                </div>
                {PERIODS.map((period) => {
                  const price = planPrice(plan, period)
                  return (
                    <div key={period} className="lp-price" data-for={period}>
                      <p>
                        <span className="lp-amount num">{price.amount}</span>
                        <span className="lp-per">{price.per}</span>
                      </p>
                      <p className="lp-price-note">{price.note}</p>
                    </div>
                  )
                })}
                <ButtonLink variant={featured ? 'primary' : 'ghost'} href={planSignupHref(plan)}>
                  {PLAN_CTA[plan]}
                </ButtonLink>
                <ul role="list" aria-label={`${info.name} includes`}>
                  {info.highlights.map((highlight) => (
                    <li key={highlight}>
                      <CheckIcon size={16} strokeWidth={2.4} />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>
      </PricingSwitch>
    </section>
  )
}
