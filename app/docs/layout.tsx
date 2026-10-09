import type { ReactNode } from 'react'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SiteNav } from '@/components/landing/SiteNav'
import '@/styles/landing.css'
import '@/styles/docs.css'

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <SiteNav current="docs" />
      <main id="main" className="dc">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
