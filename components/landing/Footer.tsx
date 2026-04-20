import Link from 'next/link'

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link href="/" className="footer-logo">
            <div className="footer-logo-icon">P</div>
            PulsePages
          </Link>
          <p className="footer-tagline">Beautiful status pages that build trust.</p>
        </div>
        <div className="footer-links">
          <div className="footer-column">
            <h4 className="footer-column-title">Product</h4>
            <Link href="/#features" className="footer-link">Features</Link>
            <Link href="/#pricing" className="footer-link">Pricing</Link>
            <Link href="/#faq" className="footer-link">FAQ</Link>
          </div>
          <div className="footer-column">
            <h4 className="footer-column-title">Legal</h4>
            <Link href="#" className="footer-link">Privacy Policy</Link>
            <Link href="#" className="footer-link">Terms of Service</Link>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <p className="footer-copyright">&copy; {new Date().getFullYear()} PulsePages. All rights reserved.</p>
      </div>
    </footer>
  )
}
