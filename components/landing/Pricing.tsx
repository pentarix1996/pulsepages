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
    cta: 'Select Pro',
    featured: true,
  },
  {
    name: 'Business',
    monthly: 29,
    annual: 24,
    description: 'For organizations that need maximum reliability.',
    features: ['Unlimited status pages', 'Unlimited components', 'Unlimited incident history', 'Priority support'],
    cta: 'Select Business',
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
          <span
            className={`pricing-toggle-switch ${annual ? 'active' : ''}`}
            role="switch"
            tabIndex={0}
            aria-checked={annual}
            onClick={() => setAnnual((prev) => !prev)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAnnual((prev) => !prev) }}
          />
          <span className={`pricing-toggle-label ${annual ? 'active' : ''}`}>
            Annual <span className="pricing-save">Save 20%</span>
          </span>
        </div>
      </div>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <div className={`pricing-card ${plan.featured ? 'pricing-card-featured' : ''}`} key={plan.name}>
            {plan.featured ? <div className="pricing-card-popular">Most Popular</div> : null}
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
                <li className="pricing-feature" key={f}>
                  <span className="pricing-feature-icon pricing-feature-icon-check">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
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
