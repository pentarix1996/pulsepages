import { CalendarIcon } from '@/components/ui/icons'
import { Points, SectionIntro } from './parts'

type LightTick = '' | 'd' | 'p' | 'm' | 'mt'

const ROWS: ReadonlyArray<{ name: string; uptime: string; events: Record<number, LightTick> }> = [
  { name: 'API Gateway', uptime: '99.998%', events: { 12: 'd' } },
  { name: 'Payments API', uptime: '99.941%', events: { 8: 'p', 30: 'd', 44: 'm' } },
  { name: 'Dashboard', uptime: '99.995%', events: { 22: 'mt' } },
]
const DAYS = 45

function LightBars({ events }: { events: Record<number, LightTick> }) {
  return (
    <span className="lp-lb" aria-hidden="true">
      {Array.from({ length: DAYS }, (_, index) => (
        <span key={index} className={events[index] || undefined} />
      ))}
    </span>
  )
}

export function StatusPages() {
  return (
    <section id="status-pages" className="lp-wrap lp-section" aria-labelledby="status-pages-title">
      <div className="lp-split">
        <SectionIntro
          id="status-pages-title"
          title="A status page people actually check"
          lede="Up to ninety days of uptime for every component, maintenance announced ahead of time, and updates for anyone who subscribes. From Pro, on your own domain and in your colors."
        >
          <Points
            items={[
              'Subscriptions by email, Slack and webhook, plus RSS, Atom and JSON feeds',
              'Scheduled maintenance that mutes alerts during the window',
              'Private pages for internal services, with SSO, IP allow-lists or access links on Business',
            ]}
          />
        </SectionIntro>

        <figure className="lp-sp" aria-label="Example public status page for Quillbase">
          <div className="lp-sp-h">
            <span className="lp-sp-brand">
              <span className="lp-sp-logo" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 4C10 4 5 10 4 20" />
                  <path d="M14 4c0 4-2 7-6 9" />
                </svg>
              </span>
              Quillbase
            </span>
            <span className="lp-sp-subscribe">Subscribe</span>
          </div>
          <div className="lp-sp-maint">
            <CalendarIcon size={16} />
            <span>
              <strong>Postgres upgrade</strong> on Sat 17 Oct, 04:00–04:30 your time. Reads stay available.
            </span>
          </div>
          <div className="lp-sp-card">
            {ROWS.map((row) => (
              <div key={row.name} className="lp-sp-row">
                <div className="lp-sp-row-h">
                  <span>{row.name}</span>
                  <span className="num">{row.uptime}</span>
                </div>
                <LightBars events={row.events} />
              </div>
            ))}
          </div>
          <div className="lp-sp-chips">
            <span>Email</span>
            <span>RSS</span>
            <span>Slack</span>
            <span>Webhook</span>
          </div>
        </figure>
      </div>
    </section>
  )
}
