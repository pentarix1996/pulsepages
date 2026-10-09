// Channel types as the dashboard presents them: icon, copy and exact setup steps for each provider.
import type { ComponentType, ReactNode } from 'react'
import type { AlertChannelType } from '@shared/domain.ts'
import { ChatIcon, MailIcon, PagerIcon, WebhookIcon, type IconProps } from '@/components/ui/icons'

export interface ChannelTypeMeta {
  type: AlertChannelType
  label: string
  blurb: string
  icon: ComponentType<IconProps>
  /** PagerDuty and Opsgenie: Business plan, outages and incidents only. */
  paging: boolean
  defaultName: string
  secretField?: { key: 'webhook_url' | 'url' | 'routing_key' | 'api_key'; label: string; placeholder: string; mono: boolean }
  steps: ReactNode[]
}

const code = (text: string) => <span className="mono">{text}</span>

export const CHANNEL_TYPES: ChannelTypeMeta[] = [
  {
    type: 'email',
    label: 'Email',
    blurb: 'Send alerts to people on your team.',
    icon: MailIcon,
    paging: false,
    defaultName: 'Team email',
    steps: [
      'Add the addresses that should get alerts, one per line or separated by commas.',
      'Members of your organization receive alerts right away. Anyone else gets an email and receives alerts only after confirming.',
    ],
  },
  {
    type: 'slack',
    label: 'Slack',
    blurb: 'Post to a channel with an incoming webhook.',
    icon: ChatIcon,
    paging: false,
    defaultName: '#ops-alerts',
    secretField: { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/T000/B000/XXXX', mono: true },
    steps: [
      <>Go to {code('api.slack.com/apps')}, choose Create New App → From scratch and pick your workspace.</>,
      <>Open Incoming Webhooks, turn them on and click Add New Webhook to Workspace.</>,
      <>Choose the channel that should get alerts, such as {code('#ops-alerts')}, and click Allow.</>,
      <>Copy the webhook URL (it starts with {code('https://hooks.slack.com/services/')}) and paste it below.</>,
    ],
  },
  {
    type: 'teams',
    label: 'Microsoft Teams',
    blurb: 'Post to a channel through a Teams workflow.',
    icon: ChatIcon,
    paging: false,
    defaultName: 'Teams on-call',
    secretField: { key: 'webhook_url', label: 'Workflow URL', placeholder: 'https://prod-00.westus.logic.azure.com/workflows/…', mono: true },
    steps: [
      <>In Teams, open the channel, click ••• next to its name and choose Workflows.</>,
      <>Pick the template “Post to a channel when a webhook request is received” and finish the steps.</>,
      <>Copy the URL the workflow shows at the end and paste it below. Older Office 365 connector URLs ({code('…webhook.office.com')}) also work.</>,
    ],
  },
  {
    type: 'discord',
    label: 'Discord',
    blurb: 'Post to a channel with a Discord webhook.',
    icon: ChatIcon,
    paging: false,
    defaultName: '#incidents',
    secretField: { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…', mono: true },
    steps: [
      <>Open Server Settings → Integrations → Webhooks and click New Webhook.</>,
      <>Choose the channel, name the webhook (for example Upvane) and click Copy Webhook URL.</>,
      <>Paste it below. It starts with {code('https://discord.com/api/webhooks/')}.</>,
    ],
  },
  {
    type: 'webhook',
    label: 'Webhook',
    blurb: 'Send signed JSON to your own endpoint.',
    icon: WebhookIcon,
    paging: false,
    defaultName: 'Ops webhook',
    secretField: { key: 'url', label: 'Endpoint URL', placeholder: 'https://ops.example.com/hooks/upvane', mono: true },
    steps: [
      <>Enter a public {code('https://')} endpoint that accepts POST requests with a JSON body. Each request carries {code('Upvane-Event')} and {code('Upvane-Delivery')} headers.</>,
      <>Turn on signing to get an {code('Upvane-Signature: t=<unix time>,v1=<hex>')} header: an HMAC-SHA256 of {code('<t>.<body>')} with your secret.</>,
      <>Answer with any 2xx status. Timeouts, 429 and 5xx answers are retried up to 5 times; other 4xx answers are not.</>,
    ],
  },
  {
    type: 'pagerduty',
    label: 'PagerDuty',
    blurb: 'Page the on-call engineer. Recoveries resolve the page.',
    icon: PagerIcon,
    paging: true,
    defaultName: 'PagerDuty on-call',
    secretField: { key: 'routing_key', label: 'Integration key', placeholder: '32 characters, from the Events API V2 integration', mono: true },
    steps: [
      <>In PagerDuty, open Services → Service Directory and choose the service to page (or create one).</>,
      <>On its Integrations tab, click Add an integration, choose Events API V2 and click Add.</>,
      <>Expand the new integration, copy the Integration Key and paste it below.</>,
      <>Outages and incidents open a page; recoveries and resolved incidents resolve it on their own.</>,
    ],
  },
  {
    type: 'opsgenie',
    label: 'Opsgenie',
    blurb: 'Create Opsgenie alerts. Recoveries close them.',
    icon: PagerIcon,
    paging: true,
    defaultName: 'Opsgenie on-call',
    secretField: { key: 'api_key', label: 'API key', placeholder: '1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f', mono: true },
    steps: [
      <>In Opsgenie, open your team → Integrations (or Settings → Integrations) and click Add integration.</>,
      <>Choose API, name it Upvane, keep Create and Update Access turned on and save it.</>,
      <>Copy the API key and paste it below. Choose the EU region if you sign in at {code('app.eu.opsgenie.com')}.</>,
    ],
  },
]

export const CHANNEL_META: Record<AlertChannelType, ChannelTypeMeta> = Object.fromEntries(CHANNEL_TYPES.map((meta) => [meta.type, meta])) as Record<AlertChannelType, ChannelTypeMeta>

export function ChannelTypeIcon({ type, size = 16 }: { type: AlertChannelType; size?: number }) {
  const Icon = CHANNEL_META[type]?.icon ?? ChatIcon
  return (
    <span className={`al-type al-type-${type}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  )
}
