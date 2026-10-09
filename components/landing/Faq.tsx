import type { ReactNode } from 'react'
import { apiRateLimitPerMinute, formatLimit, planLimit } from '@shared/plans.ts'
import { PROBE_REGIONS } from '@shared/regions.ts'
import { PlusIcon } from '@/components/ui/icons'

interface Question {
  id: string
  question: string
  answer: ReactNode
}

function questions(): Question[] {
  const proRegions = planLimit('pro', 'regions_per_monitor')
  const freeRegions = planLimit('free', 'regions_per_monitor')
  return [
    {
      id: 'regions',
      question: 'Do checks run from more than one region?',
      answer: (
        <>
          Yes, on paid plans. Free monitors check from {freeRegions} region, Pro monitors from up to {proRegions} and Business monitors from any of the{' '}
          {PROBE_REGIONS.length}. A region confirms a failure after the number of consecutive failed checks you set (2 by default), and a monitor only goes
          down when the number of regions you choose agree. Errors on our probes never count as failures.
        </>
      ),
    },
    {
      id: 'downgrade',
      question: 'What happens if we downgrade?',
      answer: (
        <>
          Monitors over the new plan&apos;s limit are paused, newest first, and resume when you upgrade again. Check intervals and regions drop to what the plan
          allows, a custom domain is suspended, and history older than the plan keeps is hidden.
        </>
      ),
    },
    {
      id: 'private',
      question: 'Who can see a private status page?',
      answer: (
        <>
          Private pages are part of Business. They are visible to members of your organization, who can sign in with SSO, to visitors from IP ranges you
          allow, and to anyone with an access link you create and can revoke.
        </>
      ),
    },
    {
      id: 'domain',
      question: 'Can the status page live on our own domain?',
      answer: (
        <>
          Yes, on Pro and Business. Point a CNAME such as <span className="mono">status.yourcompany.com</span> at the target shown in your status page
          settings. Upvane verifies the record, and the TLS certificate is issued and renewed for you.
        </>
      ),
    },
    {
      id: 'rate-limits',
      question: 'Are there API rate limits?',
      answer: (
        <>
          Yes, per API key: {formatLimit(apiRateLimitPerMinute('pro'))} requests a minute on Pro and {formatLimit(apiRateLimitPerMinute('business'))} on
          Business. Every response includes <span className="mono">X-RateLimit-Limit</span>, <span className="mono">X-RateLimit-Remaining</span> and{' '}
          <span className="mono">X-RateLimit-Reset</span>, and a <span className="mono">429</span> comes with <span className="mono">Retry-After</span>.
        </>
      ),
    },
    {
      id: 'as-code',
      question: 'Can we manage everything as code?',
      answer: (
        <>
          Status pages, component groups, components, monitors, alert channels and rules, maintenance windows and SLOs are Terraform resources, and incidents
          have their own API endpoints and CLI commands. API keys can be read-only, limited to one status page, and rotated without downtime.
        </>
      ),
    },
    {
      id: 'data',
      question: 'Where is our data stored?',
      answer: (
        <>
          In Upvane&apos;s Postgres database on Supabase, in the region of our Supabase project. Probes in other regions send their results there and keep
          nothing. Secrets such as monitor headers and alert channel URLs are encrypted before they are stored and never returned by the API.
        </>
      ),
    },
  ]
}

export function Faq() {
  const items = questions()
  return (
    <section id="faq" className="lp-wrap lp-section lp-faq" aria-labelledby="faq-title">
      <h2 className="lp-h2" id="faq-title">
        Questions teams ask before switching
      </h2>
      <div className="lp-faq-list">
        {items.map((item, index) => (
          <details key={item.id} open={index === 0}>
            <summary>
              {item.question}
              <PlusIcon size={18} />
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
