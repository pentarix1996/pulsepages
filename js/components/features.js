export function renderFeatures() {
  const features = [
    {
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
      title: 'Real-time Status',
      description: 'Instantly communicate the state of every service component. Your users know before they ask.'
    },
    {
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`,
      title: 'Beautiful Pages',
      description: 'Premium, dark-themed status pages that match your brand. No generic templates — pure elegance.'
    },
    {
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
      title: 'Incident Timeline',
      description: 'Document incidents with structured updates. Build a transparent history your users can trust.'
    },
    {
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
      title: 'Uptime Tracking',
      description: 'Automatic uptime percentage calculations. Show your reliability with hard numbers — 99.99% and counting.'
    },
    {
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
      title: 'Multiple Projects',
      description: 'Manage all your services from one dashboard. Each project gets its own public status page URL.'
    },
    {
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
      title: 'Secure by Design',
      description: 'Built with security-first principles. Input sanitization, XSS prevention, and session management baked in.'
    }
  ];

  return `
    <section class="features" id="features">
      <div class="features-header">
        <span class="features-label">Features</span>
        <h2 class="features-title">Everything you need,<br>nothing you don't</h2>
        <p class="features-subtitle">Purpose-built for developers and startups who value transparency with their users.</p>
      </div>
      <div class="features-grid">
        ${features.map(f => `
          <div class="feature-card">
            <div class="feature-card-icon">${f.icon}</div>
            <h3 class="feature-card-title">${f.title}</h3>
            <p class="feature-card-description">${f.description}</p>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}
