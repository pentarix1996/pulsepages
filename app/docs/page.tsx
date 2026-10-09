import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/ui/Code'
import { SNIPPETS } from '@/components/landing/snippets'

export const metadata: Metadata = {
  title: 'Getting started',
  description: 'Set up a status page, monitors, alerts and automation with Upvane in a few steps.',
  alternates: { canonical: '/docs' },
}

const snippet = (id: string) => SNIPPETS.find((item) => item.id === id)?.source ?? ''

export default function GettingStartedPage() {
  return (
    <div className="lp-wrap">
      <div className="dc-guide">
        <header className="dc-head">
          <h1>Getting started</h1>
          <p className="lp-lede">From an empty account to a status page that updates itself, alerts the right people and is managed as code.</p>
        </header>
        <ol className="dc-steps">
          <li>
            <div>
              <h2>Create a status page and its components</h2>
              <p>
                <Link href="/register">Create an account</Link>, then a status page for your product. Add the components your customers depend on, such as API, Dashboard and Webhooks. Group them and set dependencies so a database outage shows on everything that needs it.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h2>Add monitors</h2>
              <p>
                Monitors check HTTP endpoints, keywords, TCP ports, DNS records and TLS certificates from up to 15 regions, or wait for heartbeats from your cron jobs. A problem changes component status only after the regions confirm it, so one bad network path does not page anyone.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h2>Route alerts</h2>
              <p>
                Connect email, Slack, Microsoft Teams, Discord, a signed webhook, PagerDuty or Opsgenie, then write routing rules: which events, for which components, to which channels. Cooldowns hold back repeats while something flaps. Every event, sent or held back, is in the activity log.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h2>Bring in the alerts you already have</h2>
              <p>Point Prometheus Alertmanager, Grafana, Datadog or CloudWatch at an integration URL. Firing alerts set component status like a monitor would.</p>
            </div>
          </li>
          <li>
            <div>
              <h2>Manage it as code</h2>
              <p>
                Create an API key in Settings, then use the Terraform provider, the CLI or the GitHub Action. Everything they do is in the <Link href="/docs/api">API reference</Link>.
              </p>
              <CodeBlock language="hcl" code={snippet('terraform')} />
            </div>
          </li>
          <li>
            <div>
              <h2>Open maintenance windows from CI</h2>
              <p>The GitHub Action announces a window when a deploy starts and completes it when the job ends, so subscribers know what is happening.</p>
              <CodeBlock language="yaml" code={snippet('github-action')} />
            </div>
          </li>
        </ol>
      </div>
    </div>
  )
}
