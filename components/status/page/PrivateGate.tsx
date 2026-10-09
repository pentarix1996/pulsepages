// What visitors without access see on a private status page. It never reveals components or incidents.
import { LockIcon } from '@/components/ui/icons'
import { signInUrl, type PageLocation } from '@/lib/status-page/links'
import type { PrivatePageStub } from '@/lib/status-page/types'
import { StatusShell } from './StatusShell'

export function PrivateGate({ stub, location, appUrl, notice }: { stub: PrivatePageStub['project']; location: PageLocation; appUrl: string; notice?: string | null }) {
  return (
    <StatusShell
      project={{ id: stub.id, name: stub.name, logo_url: stub.logo_url, brand_color: stub.brand_color, theme_default: 'system', timezone: 'UTC', hide_powered_by: false }}
      location={location}
      page={null}
      appUrl={appUrl}
    >
      <main className="sp-wrap">
        <section className="sp-card sp-gate" aria-labelledby="sp-gate-title">
          <span className="sp-gate-icon" aria-hidden="true">
            <LockIcon size={20} />
          </span>
          <h1 id="sp-gate-title">This status page is private</h1>
          <p className="sp-muted">
            {stub.organization_name} shares it with its team and selected customers. Sign in with your {stub.organization_name} account, or open the access link you were given.
          </p>
          {notice ? <p className="sp-error">{notice}</p> : null}
          <a className="sp-btn sp-btn-accent" href={signInUrl(location, appUrl)}>
            {stub.sso_domain ? 'Sign in with SSO' : 'Sign in'}
          </a>
          <p className="sp-fine">Access links look like this page&rsquo;s address followed by ?access_token=. Ask the team that runs the page if yours stopped working.</p>
        </section>
      </main>
    </StatusShell>
  )
}
