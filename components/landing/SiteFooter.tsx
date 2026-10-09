import Link from 'next/link'
import { Logo } from './SiteNav'

export function SiteFooter({ onLanding = false }: { onLanding?: boolean }) {
  const home = onLanding ? '' : '/'
  return (
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot-in">
        <div className="lp-foot-brand">
          <Logo />
          <p>Status pages and multi-region monitoring for on-call teams.</p>
        </div>
        <nav aria-label="Product">
          <span className="lp-foot-h">Product</span>
          <Link href={`${home}#monitoring`}>Monitoring</Link>
          <Link href={`${home}#incidents`}>Incidents</Link>
          <Link href={`${home}#status-pages`}>Status pages</Link>
          <Link href={`${home}#integrations`}>Integrations</Link>
          <Link href={`${home}#pricing`}>Pricing</Link>
        </nav>
        <nav aria-label="Developers">
          <span className="lp-foot-h">Developers</span>
          <Link href="/docs">Getting started</Link>
          <Link href="/docs/api">API reference</Link>
          <a href="/api/v1/openapi.json">OpenAPI spec</a>
          <Link href={`${home}#automation`}>Terraform, CLI and CI</Link>
        </nav>
        <nav aria-label="Account">
          <span className="lp-foot-h">Account</span>
          <Link href="/login">Sign in</Link>
          <Link href="/register">Start free</Link>
        </nav>
      </div>
    </footer>
  )
}
