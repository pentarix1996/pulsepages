import { PROBE_REGIONS, regionLabel } from '@shared/regions.ts'
import { AlertCircleIcon, CheckIcon, ShieldIcon } from '@/components/ui/icons'
import { Points, SectionIntro, Ticks } from './parts'
import { seededTicks, type Tick } from './ticks'

const REGION_TILES: ReadonlyArray<{ id: string; ms: string; slow?: boolean; events: Record<number, Tick> }> = [
  { id: 'eu-central-1', ms: '201 ms', events: {} },
  { id: 'us-east-1', ms: '912 ms', slow: true, events: { 13: 'deg', 14: 'deg', 15: 'deg' } },
  { id: 'ap-southeast-1', ms: '244 ms', events: { 6: 'deg' } },
  { id: 'sa-east-1', ms: '318 ms', events: {} },
]

export function Monitoring() {
  return (
    <section id="monitoring" className="lp-wrap lp-section" aria-labelledby="monitoring-title">
      <div className="lp-split">
        <SectionIntro
          id="monitoring-title"
          title="Checks that don't cry wolf"
          lede={`One failed request from one probe shouldn't page anyone at 3 a.m. Checks run from up to ${PROBE_REGIONS.length} regions, and a component only changes when the failure is confirmed.`}
        >
          <Points
            items={[
              'HTTP, keyword, TCP, DNS, TLS and heartbeat monitors for cron jobs and queues',
              'Assertions on status code, headers, JSON body and response time',
              'A warning before a TLS certificate expires, 14 days ahead by default',
            ]}
          />
        </SectionIntro>

        <figure className="lp-ui lp-monitor" aria-label="Example monitor with assertions and per-region latency">
          <div className="lp-monitor-h">
            <div className="lp-monitor-name">
              <strong>Payments API health</strong>
              <span className="mono">GET https://api.quillbase.io/v2/payments/health</span>
            </div>
            <span className="lp-chip lp-chip-deg">
              <span className="lp-dot" aria-hidden="true" />
              Slow in 1 region
            </span>
          </div>
          <ul className="lp-asserts" role="list">
            <li>
              <CheckIcon size={16} strokeWidth={2.4} className="ok" />
              <span>Status code is 200–299</span>
              <span className="mono">200</span>
            </li>
            <li>
              <CheckIcon size={16} strokeWidth={2.4} className="ok" />
              <span>
                Body <span className="mono">$.db</span> equals <span className="mono">&quot;ok&quot;</span>
              </span>
              <span className="mono">&quot;ok&quot;</span>
            </li>
            <li>
              <AlertCircleIcon size={16} strokeWidth={2.4} className="warn" />
              <span>Response under 800 ms, otherwise degraded</span>
              <span className="mono warn">912 ms</span>
            </li>
          </ul>
          <div className="lp-regions">
            {REGION_TILES.map((tile, index) => (
              <div key={tile.id} className="lp-region">
                <div className="lp-region-h">
                  <span>{regionLabel(tile.id)}</span>
                  <span className={tile.slow ? 'mono warn' : 'mono'}>{tile.ms}</span>
                </div>
                <Ticks ticks={seededTicks(17 + index * 5, 16, tile.events).map((tick) => (tick === 'part' ? 'deg' : tick))} className="sm" />
              </div>
            ))}
          </div>
          <figcaption className="lp-monitor-f">
            <ShieldIcon size={16} />
            Component changes after 2 consecutive failures in at least 2 regions.
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
