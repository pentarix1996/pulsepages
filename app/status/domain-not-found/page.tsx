import type { Metadata } from 'next'
import '@/styles/status.css'

export const metadata: Metadata = { title: { absolute: 'Status page not found' }, robots: { index: false } }

/** Custom domains that point at Upvane but belong to no verified status page land here (proxy.ts). */
export default function DomainNotFound() {
  return (
    <div className="sp">
      <main className="sp-wrap">
        <section className="sp-card sp-gate" aria-labelledby="sp-dnf-title">
          <h1 id="sp-dnf-title">No status page here yet</h1>
          <p className="sp-muted">This domain points at Upvane, but no status page has verified it. If you run this page, add the domain in the status page settings and check its DNS record.</p>
          <a className="sp-btn sp-btn-quiet" href={process.env.NEXT_PUBLIC_APP_URL ?? 'https://upvane.com'}>
            Go to Upvane
          </a>
        </section>
      </main>
    </div>
  )
}
