'use client'

import { useState } from 'react'
import Link from 'next/link'

const plans = [
  {
    name: 'Free',
    monthly: 0,
    annual: 0,
    description: 'Perfect for side projects and personal use.',
    features: ['1 status page', '3 components per page', '7-day incident history', 'Community support'],
    cta: 'Get started',
    featured: false,
  },
  {
    name: 'Pro',
    monthly: 9,
    annual: 7,
    description: 'For growing teams and startups who need more.',
    features: ['5 status pages', '10 components per page', '90-day incident history', 'Custom domain', 'API access', 'Email support'],
    cta: 'Start free trial',
    featured: true,
  },
  {
    name: 'Business',
    monthly: 29,
    annual: 24,
    description: 'For organizations that need maximum reliability.',
    features: ['Unlimited status pages', 'Unlimited components', '1-year incident history', 'White-label branding', 'Priority support', 'SSO & SAML', 'SLA guarantee'],
    cta: 'Contact sales',
    featured: false,
  },
]

export function Pricing() {
  const [annual, setAnnual] = useState(false)

  return (
    <section className="pricing" id="pricing">
      <div className="pricing-header">
        <h2 className="pricing-title">Simple, transparent pricing</h2>
        <p className="pricing-subtitle">Start free, upgrade when you need to. No hidden fees.</p>
        <div className="pricing-toggle" id="pricing-toggle">
          <span className={`pricing-toggle-label ${!annual ? 'active' : ''}`}>Monthly</span>
          <button
            className={`pricing-toggle-switch ${annual ? 'active' : ''}`}
            onClick={() => setAnnual((prev) => !prev)}
            aria-label="Toggle annual pricing"
          >
            <span className="pricing-toggle-knob" />
          </button>
          <span className={`pricing-toggle-label ${annual ? 'active' : ''}`}>
            Annual <span className="pricing-toggle-badge">Save 20%</span>
          </span>
        </div>
      </div>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <div className={`pricing-card ${plan.featured ? 'pricing-card-featured' : ''}`} key={plan.name}>
            {plan.featured ? <div className="pricing-card-badge">Most Popular</div> : null}
            <div className="pricing-card-header">
              <h3 className="pricing-card-name">{plan.name}</h3>
              <div className="pricing-card-price">
                <span className="pricing-card-amount">${annual ? plan.annual : plan.monthly}</span>
                {plan.monthly > 0 ? <span className="pricing-card-period">/month</span> : null}
              </div>
              <p className="pricing-card-description">{plan.description}</p>
            </div>
            <ul className="pricing-card-features">
              {plan.features.map((f) => (
                <li className="pricing-card-feature" key={f}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-emerald)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/register"
              className={`btn ${plan.featured ? 'btn-primary' : 'btn-ghost'} btn-block`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
