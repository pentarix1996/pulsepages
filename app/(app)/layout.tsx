'use client'

import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { Spinner } from '@/components/ui/Spinner'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth()
  const { isLoading: storeLoading } = useStore()

  if (authLoading || storeLoading) {
    return (
      <div className="app-layout">
        <div className="app-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <Spinner size={24} />
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="app-layout">
      <aside className="app-sidebar" id="app-sidebar">
        <div className="app-sidebar-header">
          <a href="/" className="app-sidebar-logo" id="app-logo">
            <div className="app-sidebar-logo-icon">P</div>
            PulsePages
          </a>
        </div>
        <nav className="app-sidebar-nav">
          <a href="/dashboard" className="app-sidebar-link" id="nav-dashboard">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
            Projects
          </a>
          <a href="/incidents" className="app-sidebar-link" id="nav-incidents">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Incidents
          </a>
          <a href="/settings" className="app-sidebar-link" id="nav-settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            Settings
          </a>
        </nav>
        <div className="app-sidebar-footer">
          <a href="/settings" className="app-sidebar-user" id="app-sidebar-user-info">
            <div className="app-sidebar-avatar" id="app-sidebar-avatar">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="app-sidebar-user-details">
              <span className="app-sidebar-user-name">{user.name}</span>
              <span className="app-sidebar-user-plan">{user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} Plan</span>
            </div>
          </a>
        </div>
      </aside>
      <main className="app-content">
        {children}
      </main>
    </div>
  )
}
