export function renderHero() {
  return `
    <section class="hero" id="hero">
      <div class="hero-content">
        <div class="hero-badge">
          <span class="hero-badge-dot"></span>
          All systems operational
        </div>
        <h1 class="hero-title">
          Status pages that<br>
          <span class="hero-title-accent">build trust</span>
        </h1>
        <p class="hero-subtitle">
          Beautiful, real-time status pages for your services. Keep your users informed with a single URL. Set up in 30 seconds — no code required.
        </p>
        <div class="hero-actions">
          <a href="#/register" class="btn btn-primary btn-lg" id="hero-cta-start">
            Start for free
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>
          <a href="#/status/cloudsync-api" class="btn btn-ghost btn-lg" id="hero-cta-demo">
            View live demo
          </a>
        </div>
      </div>
      <div class="hero-visual">
        <div class="hero-visual-inner">
          <div class="hero-visual-bar">
            <div class="hero-visual-dot" style="background-color: #ff5f57;"></div>
            <div class="hero-visual-dot" style="background-color: #febc2e;"></div>
            <div class="hero-visual-dot" style="background-color: #28c840;"></div>
            <span class="hero-visual-url">pulsepages.com/status/cloudsync-api</span>
          </div>
          <div class="hero-visual-content">
            <div class="hero-preview-status">
              <div class="hero-preview-header">
                <span class="hero-preview-title">CloudSync API</span>
                <span class="hero-preview-badge hero-preview-badge-ok">
                  <span class="status-dot status-dot-operational status-dot-pulse"></span>
                  All Systems Operational
                </span>
              </div>
              <div class="hero-preview-component">
                <span class="hero-preview-component-name">API Gateway</span>
                <span class="hero-preview-component-status">
                  <span class="status-dot status-dot-operational"></span>
                  Operational
                </span>
              </div>
              <div class="hero-preview-component">
                <span class="hero-preview-component-name">WebSocket Server</span>
                <span class="hero-preview-component-status">
                  <span class="status-dot status-dot-operational"></span>
                  Operational
                </span>
              </div>
              <div class="hero-preview-component">
                <span class="hero-preview-component-name">Database Cluster</span>
                <span class="hero-preview-component-status">
                  <span class="status-dot status-dot-operational"></span>
                  Operational
                </span>
              </div>
              <div class="hero-preview-component">
                <span class="hero-preview-component-name">Auth Service</span>
                <span class="hero-preview-component-status">
                  <span class="status-dot status-dot-degraded"></span>
                  Degraded
                </span>
              </div>
              <div class="hero-preview-component">
                <span class="hero-preview-component-name">CDN</span>
                <span class="hero-preview-component-status">
                  <span class="status-dot status-dot-operational"></span>
                  Operational
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
