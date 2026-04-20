const features = [
  {
    title: 'Real-time Monitoring',
    description: 'Monitor your services in real-time with automatic status updates and instant notifications.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    title: 'Custom Branding',
    description: 'Customize your status page with your brand colors, logo, and custom domain.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r="2.5" /><path d="M17 2l4 4-2 1" /><circle cx="6" cy="12" r="2" /><path d="M2 10l2 4" /><circle cx="10.5" cy="17.5" r="2.5" /><path d="M7 20l2-2" />
      </svg>
    ),
  },
  {
    title: 'Incident Management',
    description: 'Track, update, and communicate incidents with a built-in timeline and status updates.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  {
    title: 'API Access',
    description: 'Integrate with your CI/CD pipeline using our REST API to automate status updates.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    title: 'Component Status',
    description: 'Break down your service into components and track their individual status independently.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    title: 'Uptime Analytics',
    description: 'Track uptime percentage and incident history with a clear visual dashboard.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
]

export function Features() {
  return (
    <section className="features" id="features">
      <div className="features-header">
        <h2 className="features-title">Everything you need</h2>
        <p className="features-subtitle">Powerful features to keep your users informed and build trust in your service.</p>
      </div>
      <div className="features-grid">
        {features.map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-card-icon">{f.icon}</div>
            <h3 className="feature-card-title">{f.title}</h3>
            <p className="feature-card-description">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
