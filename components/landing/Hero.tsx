import Link from 'next/link'

export function Hero() {
  return (
    <section className="hero" id="hero">
      <div className="hero-content">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          All systems operational
        </div>
        <h1 className="hero-title">
          Status pages that<br />
          <span className="hero-title-accent">build trust</span>
        </h1>
        <p className="hero-subtitle">
          Beautiful, real-time status pages for your services. Keep your users informed with a single URL. Set up in 30 seconds — no code required.
        </p>
        <div className="hero-actions">
          <Link href="/register" className="btn btn-primary btn-lg" id="hero-cta-start">
            Start for free
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
          <Link href="/status/cloudsync-api" className="btn btn-ghost btn-lg" id="hero-cta-demo">
            View live demo
          </Link>
        </div>
      </div>
      <div className="hero-visual">
        <div className="hero-visual-inner">
          <div className="hero-visual-bar">
            <div className="hero-visual-dot" style={{ backgroundColor: '#ff5f57' }} />
            <div className="hero-visual-dot" style={{ backgroundColor: '#febc2e' }} />
            <div className="hero-visual-dot" style={{ backgroundColor: '#28c840' }} />
            <span className="hero-visual-url">upvane.com/status/cloudsync-api</span>
          </div>
          <div className="hero-visual-content">
            <div className="hero-preview-status">
              <div className="hero-preview-header">
                <span className="hero-preview-title">CloudSync API</span>
                <span className="hero-preview-badge hero-preview-badge-ok">
                  <span className="status-dot status-dot-operational status-dot-pulse" />
                  All Systems Operational
                </span>
              </div>
              {[
                { name: 'API Gateway', status: 'operational' },
                { name: 'WebSocket Server', status: 'operational' },
                { name: 'Database Cluster', status: 'operational' },
                { name: 'Auth Service', status: 'degraded' },
                { name: 'CDN', status: 'operational' },
              ].map((comp) => (
                <div className="hero-preview-component" key={comp.name}>
                  <span className="hero-preview-component-name">{comp.name}</span>
                  <span className="hero-preview-component-status">
                    <span className={`status-dot status-dot-${comp.status}`} />
                    {comp.status === 'operational' ? 'Operational' : 'Degraded'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
