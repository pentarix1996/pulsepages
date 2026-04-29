import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getOverallStatus, getStatusLabel, getStatusDotClass, getStatusColor, formatDateTime, calculateProjectUptime, UPTIME_HISTORY_DAYS } from '@/lib/utils/helpers'
import { filterIncidentsByPlan } from '@/lib/utils/plan-limits'
import type { Project, Incident, Component, Plan } from '@/lib/types'
import Link from 'next/link'

interface StatusPageParams {
  params: Promise<{ username: string; slug: string }>
}

export async function generateMetadata({ params }: StatusPageParams): Promise<Metadata> {
  const { username, slug } = await params
  return {
    title: `${slug} — Status | PulsePages`,
    description: `Real-time status page for ${slug}`,
  }
}

export default async function StatusPage({ params }: StatusPageParams) {
  const { username, slug } = await params
  const supabase = await createClient()

  // First resolve username to user_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .single()

  if (!profile) {
    return (
      <div className="status-page-public">
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </div>
          <h3 className="empty-state-title">Page not found</h3>
          <p className="empty-state-description">This status page doesn&apos;t exist or has been removed.</p>
          <Link href="/" className="btn btn-primary">Go Home</Link>
        </div>
      </div>
    )
  }

  const { data: project, error } = await supabase
    .from('projects')
    .select(`
      *,
      profiles(plan),
      components(*),
      incidents(
        *,
        incident_updates(*)
      )
    `)
    .eq('user_id', profile.id)
    .eq('slug', slug)
    .single()

  if (error || !project) {
    return (
      <div className="status-page-public">
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </div>
          <h3 className="empty-state-title">Page not found</h3>
          <p className="empty-state-description">This status page doesn&apos;t exist or has been removed.</p>
          <Link href="/" className="btn btn-primary">Go Home</Link>
        </div>
      </div>
    )
  }

  const plan = (project.profiles?.plan || 'free') as Plan
  const components = (project.components || []) as Component[]
  const allIncidents = (project.incidents || []) as Incident[]

  allIncidents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  components.sort((a, b) => new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime())

  const overallStatus = getOverallStatus(components)
  const incidents = filterIncidentsByPlan(allIncidents, plan)
  const uptime = await calculateProjectUptime(supabase, project.components || [], UPTIME_HISTORY_DAYS)
  const activeIncidents = incidents.filter((i) => i.status !== 'resolved')
  const recentResolved = incidents.filter((i) => i.status === 'resolved').slice(0, 5)

  const overallStatusClass = overallStatus === 'operational' ? 'operational'
    : overallStatus === 'degraded' ? 'degraded'
    : overallStatus === 'maintenance' ? 'maintenance' : 'down'

  const overallStatusText = overallStatus === 'operational' ? 'All Systems Operational'
    : overallStatus === 'degraded' ? 'Degraded Performance'
    : overallStatus === 'maintenance' ? 'Maintenance In Progress'
    : 'System Outage'

  return (
    <div className="status-page-public">
      <div className="status-page-header">
        <div className="status-page-logo">
          <div className="status-page-logo-icon">{project.name.charAt(0).toUpperCase()}</div>
          <span className="status-page-logo-name">{project.name}</span>
        </div>

        <div className={`status-page-overall status-page-overall-${overallStatusClass}`}>
          <span className={`status-dot ${getStatusDotClass(overallStatus)} status-dot-pulse`} />
          <span className="status-page-overall-text">{overallStatusText}</span>
        </div>
        <div className="status-page-uptime">{uptime}% uptime based on incident history</div>
      </div>

      {components.length > 0 ? (
        <>
          <div className="status-page-section-title">Current Status</div>
          <div className="status-page-components">
            {components.map((comp) => {
              const color = getStatusColor(comp.status)
              const colorVar = color === 'success' ? 'emerald' : color === 'warning' ? 'yellow' : color === 'danger' ? 'red' : color === 'info' ? 'blue' : ''
              return (
                <div className="status-page-component" key={comp.id}>
                  <span className="status-page-component-name">{comp.name}</span>
                  <span className="status-page-component-status" style={{ color: `var(--status-${colorVar})` }}>
                    <span className={`status-dot ${getStatusDotClass(comp.status)}`} />
                    {getStatusLabel(comp.status)}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      ) : null}

      {activeIncidents.length > 0 ? (
        <>
          <div className="status-page-section-title">Active Incidents</div>
          <div className="status-page-incidents">
            <div className="incident-timeline">
              {activeIncidents.map((inc) => {
                const compNames = (inc.component_ids || [])
                  .map((cid) => components.find((c) => c.id === cid)?.name)
                  .filter(Boolean)
                return (
                  <div className="incident-item" key={inc.id}>
                    <div className={`incident-dot incident-dot-${inc.severity === 'critical' || inc.severity === 'high' ? 'danger' : inc.severity === 'medium' ? 'warning' : 'info'}`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    </div>
                    <div className="incident-content">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
                        <span className="incident-title">{inc.title}</span>
                        {compNames.map((n) => <span className="badge badge-neutral" key={n}>{n}</span>)}
                      </div>
                      <div className="incident-meta">{formatDateTime(inc.created_at)}</div>
                      {inc.description ? <p className="incident-description">{inc.description}</p> : null}
                      {(inc.incident_updates || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((u) => (
                        <div key={u.id} style={{ marginTop: 'var(--space-8)', paddingLeft: 'var(--space-12)', borderLeft: '2px solid var(--border-secondary)' }}>
                          <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>{u.message}</p>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-quaternary)' }}>{formatDateTime(u.created_at)} — {u.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : null}

      {recentResolved.length > 0 ? (
        <>
          <div className="status-page-section-title">Past Incidents</div>
          <div className="status-page-incidents">
            <div className="incident-timeline">
              {recentResolved.map((inc) => {
                const compNames = (inc.component_ids || [])
                  .map((cid) => components.find((c) => c.id === cid)?.name)
                  .filter(Boolean)
                return (
                  <div className="incident-item" key={inc.id}>
                    <div className="incident-dot incident-dot-resolved">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <div className="incident-content">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
                        <span className="incident-title">{inc.title}</span>
                        <span className="badge badge-success">Resolved</span>
                        {compNames.map((n) => <span className="badge badge-neutral" key={n}>{n}</span>)}
                      </div>
                      <div className="incident-meta">{formatDateTime(inc.created_at)}</div>
                      {inc.description ? <p className="incident-description">{inc.description}</p> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : null}

      <div className="status-page-powered">
        Powered by <Link href="/">PulsePages</Link>
      </div>
    </div>
  )
}
