import Link from 'next/link'

export function Footer() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer-inner">
        <div className="landing-footer-top">
          <div className="landing-footer-brand">
            <div className="landing-footer-brand-name">
              <div className="landing-nav-logo-icon">P</div>
              Upvane
            </div>
            <p className="landing-footer-brand-desc">Beautiful status pages that build trust. Real-time service monitoring for developers and startups.</p>
          </div>
          <div>
            <h4 className="landing-footer-column-title">Product</h4>
            <div className="landing-footer-column-links">
              <Link href="/#features" className="landing-footer-link">Features</Link>
              <Link href="/#pricing" className="landing-footer-link">Pricing</Link>
              <Link href="/#faq" className="landing-footer-link">FAQ</Link>
            </div>
          </div>
          <div>
            <h4 className="landing-footer-column-title">Company</h4>
            <div className="landing-footer-column-links">
              <Link href="#" className="landing-footer-link">About</Link>
              <Link href="#" className="landing-footer-link">Blog</Link>
              <Link href="#" className="landing-footer-link">Careers</Link>
            </div>
          </div>
          <div>
            <h4 className="landing-footer-column-title">Legal</h4>
            <div className="landing-footer-column-links">
              <Link href="#" className="landing-footer-link">Privacy Policy</Link>
              <Link href="#" className="landing-footer-link">Terms of Service</Link>
            </div>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <p className="landing-footer-copyright">&copy; {new Date().getFullYear()} Upvane. All rights reserved.</p>
          <div className="landing-footer-legal">
            <Link href="#">Privacy</Link>
            <Link href="#">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
