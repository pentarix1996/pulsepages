'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { useToast } from '@/hooks/useToast'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Pagination } from '@/components/ui/Pagination'
import { canAddComponent } from '@/lib/utils/plan-limits'
import { getStatusLabel, formatDateTime, getSeverityBadgeVariant, copyToClipboard } from '@/lib/utils/helpers'
import { sanitizeInput, validateSlug } from '@/lib/utils/security'
import { slugify } from '@/lib/utils/helpers'
import type { ComponentStatus, IncidentStatus, IncidentSeverity, Incident } from '@/lib/types'

const STATUS_OPTIONS = [
  { value: 'operational', label: 'Operational' },
  { value: 'degraded', label: 'Degraded Performance' },
  { value: 'partial_outage', label: 'Partial Outage' },
  { value: 'major_outage', label: 'Major Outage' },
  { value: 'maintenance', label: 'Under Maintenance' },
]

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const INCIDENT_STATUS_OPTIONS = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
]

export default function ProjectEditorPage() {
  const params = useParams()
  const projectId = params.id as string
  const isNew = projectId === 'new'

  if (isNew) return <NewProjectForm />
  return <EditProject projectId={projectId} />
}

function NewProjectForm() {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { user } = useAuth()
  const { addProject } = useStore()
  const { addToast } = useToast()
  const router = useRouter()

  const handleNameChange = (val: string) => {
    setName(val)
    setSlug(slugify(val))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError('')

    const cleanName = sanitizeInput(name)
    const cleanSlug = sanitizeInput(slug)
    const cleanDesc = sanitizeInput(description)

    if (!cleanName || cleanName.length < 2) { setError('Name must be at least 2 characters.'); return }
    if (!validateSlug(cleanSlug)) { setError('Slug must be lowercase letters, numbers, and hyphens.'); return }

    setLoading(true)
    const result = await addProject({ name: cleanName, slug: cleanSlug, description: cleanDesc, userId: user.id })
    setLoading(false)

    if (result.success && result.project) {
      addToast('Project created successfully!')
      router.push(`/project/${result.project.id}`)
    } else {
      setError(result.error || 'Failed to create project.')
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">New Project</h1>
          <p className="page-description">Create a new status page for your service.</p>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-16)' }}>
            <Input id="new-project-name" label="Project Name" placeholder="My Awesome API" value={name} onChange={(e) => handleNameChange(e.target.value)} required maxLength={50} />
            <Input id="new-project-slug" label="Slug" placeholder="my-awesome-api" value={slug} onChange={(e) => setSlug(e.target.value)} required maxLength={50} mono />
            <Textarea id="new-project-desc" label="Description" placeholder="Brief description..." value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={3} />
          </div>
          {error ? <div style={{ color: 'var(--status-red)', fontSize: '0.8125rem', marginTop: 'var(--space-12)' }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 'var(--space-12)', justifyContent: 'flex-end', marginTop: 'var(--space-24)' }}>
            <Button type="button" variant="ghost" onClick={() => router.push('/dashboard')}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading} id="new-project-submit">Create Project</Button>
          </div>
        </form>
      </div>
    </>
  )
}

function EditProject({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const {
    getProjectById,
    getIncidentsByProject,
    addComponent,
    updateComponentStatus,
    deleteComponent,
    addIncident,
    updateIncident,
    deleteProject,
    incidentsPage,
    pagination,
    filters,
    isPaginating,
    setFilters,
    setPage,
    fetchIncidentsPage,
    getDeduplicatedComponentNames,
  } = useStore()
  const { addToast } = useToast()
  const router = useRouter()

  const [showAddComponent, setShowAddComponent] = useState(false)
  const [showCreateIncident, setShowCreateIncident] = useState(false)
  const [showDeleteProject, setShowDeleteProject] = useState(false)
  const [showUpdateIncident, setShowUpdateIncident] = useState<Incident | null>(null)

  const [newComponentName, setNewComponentName] = useState('')
  const [componentLoading, setComponentLoading] = useState(false)

  const [incTitle, setIncTitle] = useState('')
  const [incDesc, setIncDesc] = useState('')
  const [incStatus, setIncStatus] = useState<IncidentStatus>('investigating')
  const [incSeverity, setIncSeverity] = useState<IncidentSeverity>('medium')
  const [incComponents, setIncComponents] = useState<string[]>([])
  const [incLoading, setIncLoading] = useState(false)

  const [updateMsg, setUpdateMsg] = useState('')
  const [updateStatus, setUpdateStatus] = useState<IncidentStatus>('monitoring')
  const [updateLoading, setUpdateLoading] = useState(false)

  const [deleteLoading, setDeleteLoading] = useState(false)

  const project = getProjectById(projectId)
  const projectIncidents = getIncidentsByProject(projectId)
  const componentNames = getDeduplicatedComponentNames(projectId)

  // Set project filter on mount and fetch paginated incidents
  // Note: NOT adding setFilters or fetchIncidentsPage to deps — they are stable
  // callbacks from the store. Adding them causes infinite loops because
  // fetchIncidentsPage's reference changes when user changes (useCallback deps).
  useEffect(() => {
    if (projectId) {
      setFilters({ projectId })
      setTimeout(() => fetchIncidentsPage(), 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const handleProjectFilterChange = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters(newFilters)
    setTimeout(() => fetchIncidentsPage(), 0)
  }, [setFilters, fetchIncidentsPage])

  const handlePageChange = useCallback((page: number) => {
    setPage(page)
    // Pass page number directly to avoid stale closure (state update is async)
    fetchIncidentsPage(page)
  }, [setPage, fetchIncidentsPage])

  // After incident mutations, refresh the paginated list
  const refreshIncidentsPage = useCallback(() => {
    fetchIncidentsPage()
  }, [fetchIncidentsPage])

  if (!project || !user) {
    return <EmptyState title="Project not found" description="This project doesn't exist or you don't have access." action={<Button variant="primary" onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>} />
  }

  const handleAddComponent = async () => {
    const name = sanitizeInput(newComponentName)
    if (!name || name.length < 2) return

    const check = canAddComponent(user.plan, project.components.length)
    if (!check.allowed) { addToast(check.message, 'warning'); return }

    setComponentLoading(true)
    const res = await addComponent(projectId, name)
    setComponentLoading(false)

    if (!res.success) {
      addToast(res.error || 'Failed to add component', 'error')
      return
    }

    setNewComponentName('')
    setShowAddComponent(false)
    addToast('Component added!')
  }

  const handleStatusChange = async (componentId: string, status: string) => {
    await updateComponentStatus(componentId, projectId, status)
  }

  const handleDeleteComponent = async (componentId: string) => {
    if (!confirm('Delete this component?')) return
    await deleteComponent(componentId, projectId)
    addToast('Component deleted.')
  }

  const handleCreateIncident = async () => {
    const title = sanitizeInput(incTitle)
    if (!title || title.length < 2) return

    setIncLoading(true)
    const res = await addIncident({
      projectId,
      title,
      description: sanitizeInput(incDesc),
      status: incStatus,
      severity: incSeverity,
      components: incComponents,
    })
    setIncLoading(false)

    if (!res.success) {
      addToast(res.error || 'Failed to report incident', 'error')
      return
    }

    setIncTitle('')
    setIncDesc('')
    setIncComponents([])
    setShowCreateIncident(false)
    addToast('Incident reported!')
    refreshIncidentsPage()
  }

  const handleUpdateIncident = async () => {
    if (!showUpdateIncident || !updateMsg) return

    setUpdateLoading(true)
    await updateIncident(
      showUpdateIncident.id,
      { status: updateStatus },
      sanitizeInput(updateMsg)
    )
    setUpdateLoading(false)
    setUpdateMsg('')
    setShowUpdateIncident(null)
    addToast('Incident updated!')
    refreshIncidentsPage()
  }

  const handleDeleteProject = async () => {
    setDeleteLoading(true)
    await deleteProject(projectId)
    setDeleteLoading(false)
    addToast('Project deleted.')
    router.push('/dashboard')
  }

  const statusPageUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/status/${project.profiles?.username}/${project.slug}`

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-description">/{project.profiles?.username}/{project.slug}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(statusPageUrl).then(() => addToast('URL copied!'))}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            Copy URL
          </Button>
          <Link className="btn btn-ghost btn-sm" href={`/project/${projectId}/monitoring`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
            Monitoring
          </Link>
          <Link className="btn btn-ghost btn-sm" href={`/project/${projectId}/alerts`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            Alerts
          </Link>
          <Button variant="ghost" size="sm" onClick={() => window.open(statusPageUrl, '_blank')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            View Status Page
          </Button>
        </div>
      </div>

      {/* Components Section */}
      <div className="editor-section">
        <div className="editor-section-header">
          <h2 className="editor-section-title">Components</h2>
          <Button variant="subtle" size="sm" onClick={() => setShowAddComponent(true)} id="add-component-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add
          </Button>
        </div>

        {project.components.length === 0 ? (
          <EmptyState title="No components" description="Add your first component to start monitoring." />
        ) : (
          <div className="component-list">
            {project.components.map((comp) => (
              <div className="component-item" key={comp.id}>
                <div className="component-item-info">
                  <StatusDot status={comp.status} />
                  <span className="component-item-name">{comp.name}</span>
                </div>
                <div className="component-item-actions">
                  <select
                    className="component-status-select"
                    value={comp.status}
                    onChange={(e) => handleStatusChange(comp.id, e.target.value)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button className="btn btn-icon" style={{ width: 28, height: 28 }} onClick={() => handleDeleteComponent(comp.id)} aria-label="Delete component">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--status-red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Incidents Section */}
      <div className="editor-section">
        <div className="editor-section-header">
          <h2 className="editor-section-title">Incidents</h2>
          <Button variant="subtle" size="sm" onClick={() => setShowCreateIncident(true)} id="report-incident-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Report
          </Button>
        </div>

        <FilterBar
          projects={[]}
          componentNames={componentNames}
          filters={filters}
          onFilterChange={handleProjectFilterChange}
          isLoading={isPaginating}
          showProjectSelect={false}
        />

        <div className="editor-section-body">
          {isPaginating && incidentsPage.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-32)' }}>
              <Spinner size={24} />
            </div>
          ) : incidentsPage.length === 0 ? (
            <EmptyState
              title="No incidents"
              description="All systems running smoothly."
              icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
            />
          ) : (
            <>
              <div className="incident-timeline">
                {incidentsPage.map((inc) => {
                  const badgeVariant = getSeverityBadgeVariant(inc.status, inc.severity)
                  const compNames = (inc.component_ids || []).map((cid) => {
                    const comp = project.components.find((c) => c.id === cid)
                    return comp?.name
                  }).filter(Boolean)

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
                          {compNames.map((n) => <Badge key={n} variant="neutral">{n}</Badge>)}
                        </div>
                        <div className="incident-meta">{formatDateTime(inc.created_at)}</div>
                        {inc.description ? <p className="incident-description">{inc.description}</p> : null}
                        {(inc.incident_updates || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((u) => (
                          <div key={u.id} style={{ marginTop: 'var(--space-8)', paddingLeft: 'var(--space-12)', borderLeft: '2px solid var(--border-secondary)' }}>
                            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>{u.message}</p>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-quaternary)' }}>{formatDateTime(u.created_at)} — {u.status}</span>
                          </div>
                        ))}
                        {inc.status !== 'resolved' ? (
                          <div style={{ marginTop: 'var(--space-8)' }}>
                            <Button variant="subtle" size="sm" onClick={() => { setShowUpdateIncident(inc); setUpdateStatus(inc.status as IncidentStatus) }}>
                              Add Update
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>

              {pagination.totalCount > 0 && (
                <Pagination
                  page={pagination.page}
                  limit={pagination.limit}
                  totalCount={pagination.totalCount}
                  onPageChange={handlePageChange}
                  isLoading={isPaginating}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="editor-section" style={{ marginTop: 'var(--space-32)' }}>
        <div className="editor-section-header">
          <h2 className="editor-section-title" style={{ color: 'var(--status-red)' }}>Danger Zone</h2>
        </div>
        <div className="editor-section-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.9375rem', fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' }}>Delete this project</p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>This action cannot be undone.</p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setShowDeleteProject(true)} id="delete-project-btn">Delete</Button>
        </div>
      </div>

      {/* Modal: Add Component */}
      <Modal isOpen={showAddComponent} onClose={() => setShowAddComponent(false)} title="Add Component" footer={<><Button variant="ghost" onClick={() => setShowAddComponent(false)}>Cancel</Button><Button variant="primary" loading={componentLoading} onClick={handleAddComponent}>Add Component</Button></>}>
        <Input id="add-component-name" label="Component Name" placeholder="e.g., API Gateway" value={newComponentName} onChange={(e) => setNewComponentName(e.target.value)} maxLength={50} />
      </Modal>

      {/* Modal: Create Incident */}
      <Modal isOpen={showCreateIncident} onClose={() => setShowCreateIncident(false)} title="Report Incident" footer={<><Button variant="ghost" onClick={() => setShowCreateIncident(false)}>Cancel</Button><Button variant="primary" loading={incLoading} onClick={handleCreateIncident}>Report Incident</Button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-16)' }}>
          <Input id="inc-title" label="Title" placeholder="Brief incident title" value={incTitle} onChange={(e) => setIncTitle(e.target.value)} maxLength={100} />
          <Textarea id="inc-desc" label="Description" placeholder="What happened?" value={incDesc} onChange={(e) => setIncDesc(e.target.value)} rows={3} />
          <Select id="inc-status" label="Status" options={INCIDENT_STATUS_OPTIONS} value={incStatus} onChange={(e) => setIncStatus(e.target.value as IncidentStatus)} />
          <Select id="inc-severity" label="Severity" options={SEVERITY_OPTIONS} value={incSeverity} onChange={(e) => setIncSeverity(e.target.value as IncidentSeverity)} />
          <div className="input-group">
            <label className="input-label">Affected Components</label>
            {project.components.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={incComponents.includes(c.id)} onChange={(e) => {
                  setIncComponents((prev) => e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id))
                }} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
      </Modal>

      {/* Modal: Update Incident */}
      <Modal isOpen={!!showUpdateIncident} onClose={() => setShowUpdateIncident(null)} title="Update Incident" footer={<><Button variant="ghost" onClick={() => setShowUpdateIncident(null)}>Cancel</Button><Button variant="primary" loading={updateLoading} onClick={handleUpdateIncident}>Post Update</Button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-16)' }}>
          <Select id="update-status" label="New Status" options={INCIDENT_STATUS_OPTIONS} value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value as IncidentStatus)} />
          <Textarea id="update-msg" label="Update Message" placeholder="What's the latest?" value={updateMsg} onChange={(e) => setUpdateMsg(e.target.value)} rows={3} />
        </div>
      </Modal>

      {/* Modal: Delete Project */}
      <Modal isOpen={showDeleteProject} onClose={() => setShowDeleteProject(false)} title="Delete Project" footer={<><Button variant="ghost" onClick={() => setShowDeleteProject(false)}>Cancel</Button><Button variant="danger" loading={deleteLoading} onClick={handleDeleteProject}>Delete Project</Button></>}>
        <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>Are you sure? This will permanently delete <strong>{project.name}</strong>, all its components, and all associated incidents.</p>
      </Modal>
    </>
  )
}
