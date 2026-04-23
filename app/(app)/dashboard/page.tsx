'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { useToast } from '@/hooks/useToast'
import { canCreateProject } from '@/lib/utils/plan-limits'
import { getOverallStatus, getStatusDotClass, timeAgo } from '@/lib/utils/helpers'
import { calculateUptimeFromHistory, UPTIME_HISTORY_DAYS } from '@/lib/utils/helpers'
import { createClient } from '@/lib/supabase/client'
import { StatusDot } from '@/components/ui/StatusDot'

export default function DashboardPage() {
  const { user } = useAuth()
  const { projects, incidents } = useStore()
  const { addToast } = useToast()
  const router = useRouter()
  const supabase = createClient()
  const [uptimeByProject, setUptimeByProject] = useState<Record<string, string>>({})

  if (!user) return null

  const userProjects = projects.filter((p) => p.user_id === user.id)

  const handleNewProject = () => {
    const check = canCreateProject(user.plan, userProjects.length)
    if (!check.allowed) {
      addToast(check.message, 'warning')
      return
    }
    router.push('/project/new')
  }

  // Calculate uptime for each project based on status history
  useEffect(() => {
    if (userProjects.length === 0) return

    const fetchUptimes = async () => {
      const results: Record<string, string> = {}
      await Promise.all(
        userProjects.map(async (project) => {
          const uptime = await calculateUptimeFromHistory(supabase, project.id, UPTIME_HISTORY_DAYS)
          results[project.id] = uptime
        })
      )
      setUptimeByProject(results)
    }

    fetchUptimes()
  }, [userProjects, supabase])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-description">Manage your status pages and monitor your services.</p>
        </div>
        <button className="btn btn-primary" id="dashboard-new-project" onClick={handleNewProject}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New Project
        </button>
      </div>

      <div className="projects-grid" id="projects-grid">
        {userProjects.map((project) => {
          const overallStatus = getOverallStatus(project.components)
          const projectIncidents = incidents.filter((i) => i.project_id === project.id)
          const uptime = uptimeByProject[project.id] || '100.00'
          const activeIncidents = projectIncidents.filter((i) => i.status !== 'resolved').length

          return (
            <div
              className="project-card"
              key={project.id}
              id={`project-${project.id}`}
              onClick={() => router.push(`/project/${project.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div className="project-card-header">
                <div>
                  <h3 className="project-card-title">{project.name}</h3>
                  <span className="project-card-slug">/{project.slug}</span>
                </div>
                <div className="project-card-icon">
                  <StatusDot status={overallStatus} pulse />
                </div>
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 'var(--space-8)' }}>
                {project.description || ''}
              </p>
              <div className="project-card-stats">
                <div className="project-card-stat">
                  <span className="project-card-stat-value">{project.components.length}</span>
                  <span className="project-card-stat-label">Components</span>
                </div>
                <div className="project-card-stat">
                  <span className="project-card-stat-value">{uptime}%</span>
                  <span className="project-card-stat-label">Uptime</span>
                </div>
                <div className="project-card-stat">
                  <span className="project-card-stat-value">{activeIncidents}</span>
                  <span className="project-card-stat-label">Active</span>
                </div>
                <div className="project-card-stat">
                  <span className="project-card-stat-value">{timeAgo(project.updated_at)}</span>
                  <span className="project-card-stat-label">Updated</span>
                </div>
              </div>
            </div>
          )
        })}

        <div className="project-card-new" id="dashboard-new-card" onClick={handleNewProject} style={{ cursor: 'pointer' }}>
          <div className="project-card-new-icon">+</div>
          <span className="project-card-new-text">Create new project</span>
        </div>
      </div>

      {(user.plan === 'pro' || user.plan === 'business') ? (
        <div style={{ marginTop: 'var(--space-32)' }}>
          <div className="page-header">
            <div>
              <h2 className="page-title" style={{ fontSize: '1.125rem' }}>API Documentation</h2>
              <p className="page-description">Automate your status pages using our REST API.</p>
            </div>
          </div>
          <div className="card" style={{ marginBottom: 'var(--space-24)' }}>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 'var(--fw-medium)', marginBottom: 'var(--space-8)' }}>Update Component Status</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginBottom: 'var(--space-12)' }}>
              Automatically update a component&apos;s status from your CI/CD pipeline or monitoring tools.
            </p>
            <div style={{ backgroundColor: 'var(--bg-tertiary)', padding: 'var(--space-12)', borderRadius: 'var(--radius-4)', marginBottom: 'var(--space-12)', overflowX: 'auto' }}>
              <pre><code style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
{`curl -X PATCH https://api.pulsepages.dev/v1/projects/{project_id}/components/{component_id} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "degraded"}'`}
              </code></pre>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
              Status values: <span className="badge">operational</span> <span className="badge">degraded</span> <span className="badge">partial_outage</span> <span className="badge">major_outage</span> <span className="badge">maintenance</span>
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}
