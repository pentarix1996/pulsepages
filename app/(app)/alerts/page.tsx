'use client'

import Link from 'next/link'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusDot } from '@/components/ui/StatusDot'
import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { getOverallStatus, timeAgo } from '@/lib/utils/helpers'

export default function AlertsIndexPage() {
  const { user } = useAuth()
  const { projects } = useStore()

  if (!user) return null

  const userProjects = projects.filter((project) => project.user_id === user.id)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-description">Choose a project to configure Upvane operational alerts, delivery channels, and recovery notifications.</p>
        </div>
      </div>

      {userProjects.length === 0 ? (
        <EmptyState title="No projects yet" description="Create a project before configuring alerts." />
      ) : (
        <div className="projects-grid">
          {userProjects.map((project) => {
            const overallStatus = getOverallStatus(project.components)
            return (
              <Link className="project-card monitoring-project-card" href={`/project/${project.id}/alerts`} key={project.id}>
                <div className="project-card-header">
                  <div>
                    <h3 className="project-card-title">{project.name}</h3>
                    <span className="project-card-slug">/{project.profiles?.username}/{project.slug}</span>
                  </div>
                  <div className="project-card-icon"><StatusDot status={overallStatus} pulse /></div>
                </div>
                <div className="project-card-stats">
                  <div className="project-card-stat"><span className="project-card-stat-value">Email</span><span className="project-card-stat-label">Current channel</span></div>
                  <div className="project-card-stat"><span className="project-card-stat-value">3m</span><span className="project-card-stat-label">Fallback drain</span></div>
                  <div className="project-card-stat"><span className="project-card-value project-card-stat-value">{timeAgo(project.updated_at)}</span><span className="project-card-stat-label">Updated</span></div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
