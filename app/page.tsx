import type { Metadata } from 'next'
import { Automation } from '@/components/landing/Automation'
import { Faq } from '@/components/landing/Faq'
import { Hero } from '@/components/landing/Hero'
import { Incidents } from '@/components/landing/Incidents'
import { Integrations } from '@/components/landing/Integrations'
import { Monitoring } from '@/components/landing/Monitoring'
import { Pricing } from '@/components/landing/Pricing'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SiteNav } from '@/components/landing/SiteNav'
import { StatusPages } from '@/components/landing/StatusPages'
import { OG_IMAGE } from '@/components/landing/og'
import '@/styles/landing.css'

const title = 'Upvane — Status pages and multi-region monitoring'
const description =
  'Multi-region checks that confirm before they page, incident updates your customers can follow, and status pages you manage from Terraform, the CLI or CI.'

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'Upvane', url: '/', title, description, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE] },
}

export default function HomePage() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <SiteNav />
      <main id="main">
        <Hero />
        <div id="product">
          <Automation />
          <Monitoring />
          <Incidents />
          <StatusPages />
          <Integrations />
        </div>
        <Pricing />
        <Faq />
      </main>
      <SiteFooter onLanding />
    </div>
  )
}
