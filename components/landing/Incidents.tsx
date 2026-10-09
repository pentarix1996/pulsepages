import { INCIDENT_STATUS_LABELS } from '@shared/domain.ts'
import { ChevronDownIcon } from '@/components/ui/icons'
import { Points, SectionIntro } from './parts'

const STAGES = (['investigating', 'identified', 'monitoring', 'resolved'] as const).map((status) => INCIDENT_STATUS_LABELS[status])
const CURRENT_STAGE = 1

export function Incidents() {
  return (
    <section id="incidents" className="lp-wrap lp-section" aria-labelledby="incidents-title">
      <div className="lp-split lp-split-rev">
        <figure className="lp-ui lp-incident" aria-label="Example incident with stages, component statuses and a timeline">
          <div className="lp-incident-h">
            <strong>Failed payments in EU and US-East</strong>
            <span className="lp-chip lp-chip-major">Major impact</span>
          </div>
          <ol className="lp-stages" role="list">
            {STAGES.map((stage, index) => (
              <li key={stage} className={index < CURRENT_STAGE ? 'done' : index === CURRENT_STAGE ? 'on' : undefined} aria-current={index === CURRENT_STAGE ? 'step' : undefined}>
                <span aria-hidden="true" />
                {stage}
              </li>
            ))}
          </ol>
          <div className="lp-composer">
            <p>A database connection limit is causing timeouts on payment requests. We&apos;re raising the limit and draining stuck connections.</p>
            <div className="lp-composer-rows">
              <div>
                <span>Payments API</span>
                <span className="lp-chip lp-chip-part">
                  Partial outage
                  <ChevronDownIcon size={12} strokeWidth={2.4} />
                </span>
              </div>
              <div>
                <span>Webhooks</span>
                <span className="lp-chip lp-chip-deg">
                  Degraded
                  <ChevronDownIcon size={12} strokeWidth={2.4} />
                </span>
              </div>
            </div>
            <div className="lp-composer-f">
              <span className="lp-switch">
                <span className="lp-switch-track" aria-hidden="true">
                  <span />
                </span>
                Notify 312 subscribers
              </span>
              <span className="btn btn-primary btn-sm">Post update</span>
            </div>
          </div>
          <ol className="lp-timeline" role="list">
            <li>
              <span className="mono num">16:06</span>
              <span>Investigating. We&apos;re seeing failed payment requests from Europe and US-East.</span>
              <span className="tag tag-public">Public</span>
            </li>
            <li>
              <span className="mono num">16:04</span>
              <span className="muted">Marta Ruiz acknowledged the incident.</span>
              <span className="tag tag-internal">Internal</span>
            </li>
          </ol>
        </figure>

        <SectionIntro
          id="incidents-title"
          title="Incidents your whole team can follow"
          lede="Open an incident from a failing monitor with the affected components filled in. Each update sets every component's status explicitly, so the page says exactly what you mean."
        >
          <Points
            items={[
              'Internal notes stay internal; public updates reach the page and subscribers',
              'Time to acknowledge and time to resolve, recorded for every incident',
              'A postmortem draft with the full timeline when you resolve a major incident',
            ]}
          />
        </SectionIntro>
      </div>
    </section>
  )
}
