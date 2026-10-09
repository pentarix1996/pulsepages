import type { Metadata } from 'next'
import { ButtonLink } from '@/components/ui/Button'
import '@/styles/panel.css'

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } }

/** Unknown URLs, unknown status pages and records that no longer exist outside the dashboard. */
export default function NotFound() {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="card">
          <div className="card-b">
            <h1 className="auth-title">Page not found</h1>
            <p className="muted">
              Check the address for typos. If someone shared this link with you, ask them for the current one: status pages can move to a new address.
            </p>
            <div className="row" style={{ ['--gap' as string]: '10px' }}>
              <ButtonLink href="/" variant="primary">
                Go to Upvane
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
