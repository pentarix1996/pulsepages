'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/provider'

export function Navbar() {
  const { user } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <nav className="landing-nav" id="landing-nav">
        <div className="landing-nav-inner">
          <Link href="/" className="landing-nav-logo" id="nav-logo">
            <div className="landing-nav-logo-icon">P</div>
            PulsePages
          </Link>
          <div className="landing-nav-links" id="nav-links">
            <a className="landing-nav-link" href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features') }}>Features</a>
            <a className="landing-nav-link" href="#pricing" onClick={(e) => { e.preventDefault(); scrollTo('pricing') }}>Pricing</a>
            <a className="landing-nav-link" href="#faq" onClick={(e) => { e.preventDefault(); scrollTo('faq') }}>FAQ</a>
          </div>
          <div className="landing-nav-actions" id="nav-actions">
            {user ? (
              <Link href="/dashboard" className="btn btn-ghost btn-sm" id="nav-dashboard">Dashboard</Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost btn-sm" id="nav-login">Log in</Link>
                <Link href="/register" className="btn btn-primary btn-sm" id="nav-signup">Start free</Link>
              </>
            )}
          </div>
          <button
            className="landing-nav-mobile"
            id="nav-mobile-toggle"
            aria-label="Toggle menu"
            onClick={() => setMobileOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </nav>
      <div className={`mobile-menu ${mobileOpen ? 'active' : ''}`} id="mobile-menu">
        <button
          className="btn btn-icon mobile-menu-close"
          id="mobile-menu-close"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <a className="mobile-menu-link" href="#features" onClick={(e) => { e.preventDefault(); scrollTo('features'); setMobileOpen(false) }}>Features</a>
        <a className="mobile-menu-link" href="#pricing" onClick={(e) => { e.preventDefault(); scrollTo('pricing'); setMobileOpen(false) }}>Pricing</a>
        <a className="mobile-menu-link" href="#faq" onClick={(e) => { e.preventDefault(); scrollTo('faq'); setMobileOpen(false) }}>FAQ</a>
        {user ? (
          <Link href="/dashboard" className="btn btn-primary btn-lg" onClick={() => setMobileOpen(false)}>Dashboard</Link>
        ) : (
          <>
            <Link href="/login" className="btn btn-ghost btn-lg" onClick={() => setMobileOpen(false)}>Log in</Link>
            <Link href="/register" className="btn btn-primary btn-lg" onClick={() => setMobileOpen(false)}>Start free</Link>
          </>
        )}
      </div>
    </>
  )
}
