import { ALERT_CHANNEL_LABELS, INBOUND_INTEGRATION_LABELS, PAGING_CHANNEL_TYPES, type AlertChannelType } from '@shared/domain.ts'
import { SectionIntro } from './parts'

interface Item {
  label: string
  note?: string
}

const ALERT_ORDER: AlertChannelType[] = ['email', 'slack', 'teams', 'discord', 'pagerduty', 'opsgenie', 'webhook']

const COLUMNS: ReadonlyArray<{ id: string; title: string; tone: 'alerts' | 'signals' | 'subscribers' | 'code'; items: Item[] }> = [
  {
    id: 'alerts',
    title: 'Send alerts to',
    tone: 'alerts',
    items: ALERT_ORDER.map((type) => ({
      label: type === 'webhook' ? 'Signed webhooks' : ALERT_CHANNEL_LABELS[type],
      note: PAGING_CHANNEL_TYPES.includes(type) ? 'Business' : undefined,
    })),
  },
  {
    id: 'signals',
    title: 'Take signals from',
    tone: 'signals',
    items: [
      { label: INBOUND_INTEGRATION_LABELS.alertmanager },
      { label: INBOUND_INTEGRATION_LABELS.grafana },
      { label: INBOUND_INTEGRATION_LABELS.datadog },
      { label: 'Amazon CloudWatch' },
      { label: 'Any JSON webhook' },
      { label: 'Heartbeat pings from cron jobs' },
    ],
  },
  {
    id: 'subscribers',
    title: 'Keep subscribers posted by',
    tone: 'subscribers',
    items: [{ label: 'Email, with double opt-in' }, { label: 'Slack' }, { label: 'Webhooks' }, { label: 'RSS and Atom feeds' }, { label: 'JSON status endpoints' }],
  },
  {
    id: 'code',
    title: 'Automate with',
    tone: 'code',
    items: [{ label: 'REST API and OpenAPI spec' }, { label: 'Terraform provider' }, { label: 'Upvane CLI' }, { label: 'GitHub Action' }],
  },
]

export function Integrations() {
  return (
    <section id="integrations" className="lp-wrap lp-section" aria-labelledby="integrations-title">
      <SectionIntro
        id="integrations-title"
        title="Works with your on-call stack"
        lede="Upvane is the part that talks to people. Keep metrics, logs and paging where they already live."
      />
      <div className="lp-ig">
        {COLUMNS.map((column) => (
          <div key={column.id} className={`lp-ig-col tone-${column.tone}`}>
            <h3>{column.title}</h3>
            <ul role="list">
              {column.items.map((item) => (
                <li key={item.label}>
                  <span className="lp-dot" aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.note ? <span className="lp-ig-note">{item.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
