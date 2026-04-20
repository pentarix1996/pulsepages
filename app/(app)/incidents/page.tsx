'use client'

import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDateTime, getSeverityBadgeVariant } from '@/lib/utils/helpers'
import { filterIncidentsByPlan } from '@/lib/utils/plan-limits'
import type { Incident, Component } from '@/lib/types'

interface EnrichedIncident extends Incident {
  projectName: string
  projectComponents: Component[]
}

export default function IncidentsPage() {
  const { user } = useAuth()
  const { projects, incidents } = useStore()
  const router = useRouter()

  if (!user) return null

  const userProjects = projects.filter((p) => p.user_id === user.id)

  const allIncidents: EnrichedIncident[] = incidents
    .filter((inc) => userProjects.some((p) => p.id === inc.project_id))
    .map((inc) => {
      const project = userProjects.find((p) => p.id === inc.project_id)
      return { ...inc, projectName: project?.name || '', projectComponents: project?.components || [] }
    })

  const filtered = filterIncidentsByPlan(allIncidents, user.plan)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) as EnrichedIncident[]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Incidents</h1>
          <p className="page-description">View and manage all incidents across your projects.</p>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No incidents"
          description="All systems are running smoothly. No incidents to report."
          icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
        />
      ) : (
        <div className="incident-timeline">
          {filtered.map((inc) => {
            const badgeVariant = getSeverityBadgeVariant(inc.status, inc.severity)
            const compNames = (inc.component_ids || [])
              .map((cid) => inc.projectComponents.find((c) => c.id === cid)?.name)
              .filter(Boolean)

            return (
              <div className="incident-item" key={inc.id}>
                <div className={`incident-dot incident-dot-${inc.status === 'resolved' ? 'resolved' : badgeVariant}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {inc.status === 'resolved'
                      ? <polyline points="20 6 9 17 4 12" />
                      : <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>
                    }
                  </svg>
                </div>
                <div className="incident-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
                    <span className="incident-title">{inc.title}</span>
                    <Badge variant={badgeVariant}>{inc.status}</Badge>
                    <span
                      className="pill"
                      style={{ cursor: 'pointer' }}
                      onClick={() => router.push(`/project/${inc.project_id}`)}
                    >
                      {inc.projectName}
                    </span>
                    {compNames.map((n) => <Badge key={n} variant="neutral">{n}</Badge>)}
                  </div>
                  <div className="incident-meta">{formatDateTime(inc.created_at)}</div>
                  {inc.description ? <p className="incident-description">{inc.description}</p> : null}
                  {(inc.incident_updates || [])
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map((u) => (
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
      )}
    </>
  )
}
