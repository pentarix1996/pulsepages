'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth/provider'
import type { Project, Incident, Component, IncidentUpdate } from '@/lib/types'

interface StoreContextType {
  projects: Project[]
  incidents: Incident[]
  isLoading: boolean
  addProject: (data: { name: string; slug: string; description: string; userId: string }) => Promise<{ success: boolean; error?: string; project?: Project }>
  updateProject: (id: string, updates: Partial<Project>) => Promise<{ success: boolean; error?: string }>
  deleteProject: (id: string) => Promise<{ success: boolean; error?: string }>
  addComponent: (projectId: string, name: string) => Promise<{ success: boolean; error?: string; component?: Component }>
  updateComponentStatus: (componentId: string, projectId: string, status: string) => Promise<{ success: boolean; error?: string }>
  deleteComponent: (componentId: string, projectId: string) => Promise<{ success: boolean; error?: string }>
  addIncident: (data: { projectId: string; title: string; description: string; status: string; severity: string; components: string[] }) => Promise<{ success: boolean; error?: string; incident?: Incident }>
  updateIncident: (id: string, updates: Record<string, unknown>, message?: string) => Promise<{ success: boolean; error?: string }>
  deleteIncident: (id: string) => Promise<{ success: boolean; error?: string }>
  getProjectById: (id: string) => Project | undefined
  getProjectBySlug: (slug: string) => Project | undefined
  getIncidentsByProject: (projectId: string) => Incident[]
  getIncidentById: (id: string) => Incident | undefined
  refreshData: () => Promise<void>
}

const StoreContext = createContext<StoreContextType | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { user } = useAuth()
  const supabase = createClient()

  const loadData = useCallback(async () => {
    if (!user) {
      setProjects([])
      setIncidents([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    const [projectsRes, incidentsRes] = await Promise.all([
      supabase.from('projects').select('*, components(*)'),
      supabase.from('incidents').select('*, incident_updates(*)'),
    ])

    if (!projectsRes.error && projectsRes.data) {
      setProjects(projectsRes.data as Project[])
    }
    if (!incidentsRes.error && incidentsRes.data) {
      setIncidents(incidentsRes.data as Incident[])
    }

    setIsLoading(false)
  }, [user, supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  const addProject = useCallback(async (data: { name: string; slug: string; description: string; userId: string }) => {
    const { data: newProject, error } = await supabase
      .from('projects')
      .insert([{ name: data.name, slug: data.slug, description: data.description, user_id: data.userId }])
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    const project: Project = { ...newProject, components: [] }
    setProjects((prev) => [...prev, project])
    return { success: true, project }
  }, [supabase])

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    const { error } = await supabase.from('projects').update(updates).eq('id', id)
    if (error) return { success: false, error: error.message }

    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates, updated_at: new Date().toISOString() } : p))
    )
    return { success: true }
  }, [supabase])

  const deleteProject = useCallback(async (id: string) => {
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) return { success: false, error: error.message }

    setProjects((prev) => prev.filter((p) => p.id !== id))
    setIncidents((prev) => prev.filter((i) => i.project_id !== id))
    return { success: true }
  }, [supabase])

  const addComponent = useCallback(async (projectId: string, name: string) => {
    const { data, error } = await supabase
      .from('components')
      .insert([{ project_id: projectId, name, status: 'operational' }])
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, components: [...(p.components || []), data as Component] }
          : p
      )
    )
    return { success: true, component: data as Component }
  }, [supabase])

  const updateComponentStatus = useCallback(async (componentId: string, projectId: string, status: string) => {
    const { error } = await supabase.from('components').update({ status }).eq('id', componentId)
    if (error) return { success: false, error: error.message }

    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              components: p.components.map((c) =>
                c.id === componentId ? { ...c, status: status as Component['status'] } : c
              ),
            }
          : p
      )
    )
    return { success: true }
  }, [supabase])

  const deleteComponent = useCallback(async (componentId: string, projectId: string) => {
    const { error } = await supabase.from('components').delete().eq('id', componentId)
    if (error) return { success: false, error: error.message }

    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, components: p.components.filter((c) => c.id !== componentId) }
          : p
      )
    )
    return { success: true }
  }, [supabase])

  const addIncident = useCallback(async (data: {
    projectId: string
    title: string
    description: string
    status: string
    severity: string
    components: string[]
  }) => {
    const { data: incData, error: incError } = await supabase
      .from('incidents')
      .insert([{
        project_id: data.projectId,
        title: data.title,
        description: data.description,
        status: data.status,
        severity: data.severity,
        component_ids: data.components,
      }])
      .select()
      .single()

    if (incError) return { success: false, error: incError.message }

    const { data: updateData } = await supabase
      .from('incident_updates')
      .insert([{
        incident_id: incData.id,
        message: incData.description || 'Incident reported.',
        status: incData.status,
      }])
      .select()
      .single()

    const newIncident: Incident = {
      ...incData,
      incident_updates: updateData ? [updateData] : [],
    } as Incident

    setIncidents((prev) => [newIncident, ...prev])
    return { success: true, incident: newIncident }
  }, [supabase])

  const updateIncident = useCallback(async (id: string, updates: Record<string, unknown>, message?: string) => {
    const { error } = await supabase.from('incidents').update(updates).eq('id', id)
    if (error) return { success: false, error: error.message }

    let newHistoryItem: IncidentUpdate | null = null
    if (message && updates.status) {
      const { data } = await supabase
        .from('incident_updates')
        .insert([{ incident_id: id, message, status: updates.status as string }])
        .select()
        .single()
      newHistoryItem = data as IncidentUpdate | null
    }

    setIncidents((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i
        const updated = { ...i, ...updates } as Incident
        if (newHistoryItem) {
          updated.incident_updates = [newHistoryItem, ...(i.incident_updates || [])]
        }
        return updated
      })
    )
    return { success: true }
  }, [supabase])

  const deleteIncident = useCallback(async (id: string) => {
    const { error } = await supabase.from('incidents').delete().eq('id', id)
    if (error) return { success: false, error: error.message }

    setIncidents((prev) => prev.filter((i) => i.id !== id))
    return { success: true }
  }, [supabase])

  const getProjectById = useCallback((id: string) => projects.find((p) => p.id === id), [projects])
  const getProjectBySlug = useCallback((slug: string) => projects.find((p) => p.slug === slug), [projects])
  const getIncidentsByProject = useCallback((projectId: string) => incidents.filter((i) => i.project_id === projectId), [incidents])
  const getIncidentById = useCallback((id: string) => incidents.find((i) => i.id === id), [incidents])

  return (
    <StoreContext
      value={{
        projects,
        incidents,
        isLoading,
        addProject,
        updateProject,
        deleteProject,
        addComponent,
        updateComponentStatus,
        deleteComponent,
        addIncident,
        updateIncident,
        deleteIncident,
        getProjectById,
        getProjectBySlug,
        getIncidentsByProject,
        getIncidentById,
        refreshData: loadData,
      }}
    >
      {children}
    </StoreContext>
  )
}

export function useStore(): StoreContextType {
  const context = useContext(StoreContext)
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider')
  }
  return context
}
