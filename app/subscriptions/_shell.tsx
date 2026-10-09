import type { CSSProperties, ReactNode } from 'react'
import { brandStyle } from '@/lib/status-page/brand'
import type { SubscriptionPage } from '@/lib/status-page/subscriptions'

/** Light status-page frame for the subscription links (no header controls: these pages act on one link). */
export function SubscriptionShell({ page, children }: { page: SubscriptionPage | null; children: ReactNode }) {
  return (
    <div className="sp" style={brandStyle(page?.brand_color) as CSSProperties}>
      <main className="sp-wrap">
        <section className="sp-card sp-gate">
          {page ? (
            <a className="sp-brand" href={page.url}>
              {page.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- customer logo
                <img className="sp-brand-logo" src={page.logo_url} alt={page.name} />
              ) : (
                <>
                  <span className="sp-brand-mark" aria-hidden="true">
                    {page.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="sp-brand-name">{page.name}</span>
                </>
              )}
            </a>
          ) : null}
          {children}
        </section>
      </main>
    </div>
  )
}
