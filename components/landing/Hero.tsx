import { PLAN_INFO, planLimit } from '@shared/plans.ts'
import { PROBE_REGIONS } from '@shared/regions.ts'
import { ButtonLink } from '@/components/ui/Button'
import { HeroBoard } from './HeroBoard'

export function Hero() {
  const freeMonitors = planLimit('free', 'monitors')
  return (
    <>
      <section className="lp-wrap lp-hero" aria-labelledby="hero-title">
        <h1 id="hero-title" className="lp-display">
          Outages happen. Silence is optional.
        </h1>
        <div className="lp-hero-side">
          <p className="lp-lede">
            Upvane checks your endpoints from up to {PROBE_REGIONS.length} regions, updates your status page when a failure is confirmed, and tells your team and your
            customers. From the dashboard, the API or your deploy pipeline.
          </p>
          <div className="lp-ctas">
            <ButtonLink variant="primary" href="/register">
              Start free
            </ButtonLink>
            <ButtonLink variant="ghost" href="/docs">
              Read the docs
            </ButtonLink>
          </div>
          <p className="lp-note">
            {PLAN_INFO.free.name} plan includes {freeMonitors} monitors and a status page. No card needed.
          </p>
        </div>
      </section>

      <section className="lp-wrap lp-hero-board" aria-label="What happens during an outage">
        <HeroBoard />
      </section>
    </>
  )
}
