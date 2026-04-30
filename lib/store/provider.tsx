'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth/provider'
import { createSnapshot, restoreSnapshot } from '@/lib/store/snapshot'
import type { Project, Incident, Component, IncidentUpdate, ComponentStatus } from '@/lib/types'

interface PaginationState {
  page: number
  limit: number
  totalCount: number
}

interface FilterState {
  projectId: string | null
  componentId: string | null
  dateFrom: string | null
  dateTo: string | null
}

interface StoreContextType {
  projects: Project[]
  incidents: Incident[]
  isLoading: boolean
  errors: string[]
  isOffline: boolean
  // Pagination state
  pagination: PaginationState
  filters: FilterState
  incidentsPage: Incident[]
  isPaginating: boolean
  // Pagination actions
  setFilters: (filters: Partial<FilterState>) => void
  setPage: (page: number) => void
  fetchIncidentsPage: (pageOverride?: number) => Promise<void>
  addError: (error: string) => void
  clearErrors: () => void
  addProject: (data: { name: string; slug: string; description: string; userId: string }) => Promise<{ success: boolean; error?: string; project?: Project }>
  updateProject: (id: string, updates: Partial<Project>) => Promise<{ success: boolean; error?: string }>
  deleteProject: (id: string) => Promise<{ success: boolean; error?: string }>
  resetAllData: () => Promise<{ success: boolean; error?: string }>
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
  getDeduplicatedComponentNames: (projectId?: string) => { name: string; projectCount: number }[]
  refreshData: () => Promise<void>
}

const StoreContext = createContext<StoreContextType | null>(null)

interface StoreProviderProps {
  children: ReactNode
  toastFn?: (message: string, variant?: 'success' | 'warning' | 'error' | 'info') => void
}

export function StoreProvider({ children, toastFn }: StoreProviderProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [isOffline, setIsOffline] = useState(false)

  // Pagination state
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, limit: 10, totalCount: 0 })
  const [filters, setFiltersState] = useState<FilterState>({
    projectId: null,
    componentId: null,
    dateFrom: null,
    dateTo: null,
  })
  const [incidentsPage, setIncidentsPage] = useState<Incident[]>([])
  const [isPaginating, setIsPaginating] = useState(false)

  // Refs to avoid stale closures and prevent infinite loop in useEffect
  const paginationRef = useRef(pagination)
  const filtersRef = useRef(filters)

  const { user, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])

  // Toast helper - safe for SSR since toastFn is injected via props
  const toast = useCallback((message: string, variant: 'success' | 'warning' | 'error' | 'info' = 'error') => {
    if (toastFn && typeof window !== 'undefined') {
      toastFn(message, variant)
    }
  }, [toastFn])

  const loadData = useCallback(async () => {
    if (!user) {
      setProjects([])
      setIncidents([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    const [projectsRes, incidentsRes] = await Promise.all([
      supabase.from('projects').select('*, profiles(username), components(*)').eq('user_id', user.id),
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

  const fetchIncidentsPage = useCallback(async (pageOverride?: number) => {
    if (!user) return

    // Read latest state from refs; allow override for page number to avoid stale closure bugs
    const { limit } = paginationRef.current
    const filters = filtersRef.current
    const page = pageOverride ?? paginationRef.current.page

    setIsPaginating(true)

    const from = (page - 1) * limit
    const to = page * limit - 1

    // Base query on incidents table
    let query = supabase
      .from('incidents')
      .select('*, incident_updates(*)', { count: 'exact' })

    // Apply project filter
    if (filters.projectId) {
      query = query.eq('project_id', filters.projectId)
    }

    // Apply date range filters
    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom)
    }
    if (filters.dateTo) {
      // Add one day to include the full end date
      const endDate = new Date(filters.dateTo)
      endDate.setDate(endDate.getDate() + 1)
      query = query.lt('created_at', endDate.toISOString().split('T')[0])
    }

    // Apply component filter (by name → find all component IDs with that name)
    if (filters.componentId) {
      // Get all components with this name across ALL projects
      const { data: matchingComponents } = await supabase
        .from('components')
        .select('id')
        .eq('name', filters.componentId)

      if (matchingComponents && matchingComponents.length > 0) {
        const componentIds = matchingComponents.map((c: { id: string }) => c.id)
        // Filter incidents where component_ids overlaps with matching component IDs
        query = query.overlaps('component_ids', componentIds)
      } else {
        // No components with this name → no results
        setIncidentsPage([])
        setPagination(prev => ({ ...prev, totalCount: 0 }))
        setIsPaginating(false)
        return
      }
    }

    // Apply user ownership filter (for global /incidents page)
    // Projects belong to user
    if (!filters.projectId) {
      const { data: userProjectIds } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', user.id)

      if (userProjectIds && userProjectIds.length > 0) {
        query = query.in('project_id', userProjectIds.map((p: { id: string }) => p.id))
      } else {
        // No projects → no incidents
        setIncidentsPage([])
        setPagination(prev => ({ ...prev, totalCount: 0 }))
        setIsPaginating(false)
        return
      }
    }

    // Apply pagination range
    query = query.range(from, to)

    // Order by created_at DESC
    query = query.order('created_at', { ascending: false })

    const { data, count, error } = await query

    if (!error && data) {
      setIncidentsPage(data as Incident[])
      setPagination(prev => {
        const updated = { ...prev, totalCount: count || 0 }
        paginationRef.current = updated
        return updated
      })
    } else if (error) {
      // Handle error - could add to errors state
      console.error('Error fetching incidents page:', error.message)
    }

    setIsPaginating(false)
  }, [user, supabase])

  const setFilters = useCallback((newFilters: Partial<FilterState>) => {
    setFiltersState(prev => {
      const updated = { ...prev, ...newFilters }
      filtersRef.current = updated
      return updated
    })
    // Always reset to page 1 when filters change
    setPagination(prev => ({ ...prev, page: 1 }))
  }, [])

  const setPage = useCallback((page: number) => {
    setPagination(prev => {
      const updated = { ...prev, page }
      paginationRef.current = updated
      return updated
    })
  }, [])

  const getDeduplicatedComponentNames = useCallback((projectId?: string) => {
    const filteredProjects = projectId
      ? projects.filter(p => p.id === projectId)
      : projects

    const nameMap = new Map<string, string[]>()

    filteredProjects.forEach(project => {
      project.components?.forEach(comp => {
        if (!nameMap.has(comp.name)) {
          nameMap.set(comp.name, [])
        }
        nameMap.get(comp.name)!.push(project.id)
      })
    })

    return Array.from(nameMap.entries()).map(([name, projectIds]) => ({
      name,
      projectCount: projectIds.length,
    }))
  }, [projects])

  useEffect(() => {
    if (authLoading) return
    loadData()
    fetchIncidentsPage()
    // Intentionally missing fetchIncidentsPage from deps — it's called imperatively,
    // not as a reactive effect. Adding it would cause infinite loops since
    // fetchIncidentsPage's internal logic updates state that triggers re-renders.
  }, [loadData, authLoading])

  const addError = useCallback((error: string) => {
    setErrors((prev) => [...prev, error])
  }, [])

  const clearErrors = useCallback(() => {
    setErrors([])
  }, [])

  const addProject = useCallback(async (data: { name: string; slug: string; description: string; userId: string }) => {
    const snapshot = createSnapshot({ projects, incidents })

    const { data: newProject, error } = await supabase
      .from('projects')
      .insert([{ name: data.name, slug: data.slug, description: data.description, user_id: data.userId }])
      .select('*, profiles(username)')
      .single()

    if (error) {
      restoreSnapshot(snapshot)
      toast(error.message, 'error')
      addError(error.message)
      return { success: false, error: error.message }
    }

    const project: Project = { ...newProject, components: [] }
    setProjects((prev) => [...prev, project])
    return { success: true, project }
  }, [supabase, projects, incidents, toast, addError])

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    const snapshot = createSnapshot({ projects, incidents })

    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates, updated_at: new Date().toISOString() } : p))
    )

    const { error } = await supabase.from('projects').update(updates).eq('id', id)
    if (error) {
      restoreSnapshot(snapshot)
      toast(error.message, 'error')
      addError(error.message)
      return { success: false, error: error.message }
    }

    return { success: true }
  }, [supabase, projects, incidents, toast, addError])

  const deleteProject = useCallback(async (id: string) => {
    const snapshot = createSnapshot({ projects, incidents })

    setProjects((prev) => prev.filter((p) => p.id !== id))
    setIncidents((prev) => prev.filter((i) => i.project_id !== id))

    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) {
      restoreSnapshot(snapshot)
      toast(error.message, 'error')
      addError(error.message)
      return { success: false, error: error.message }
    }

    return { success: true }
  }, [supabase, projects, incidents, toast, addError])

  const resetAllData = useCallback(async () => {
    const { error } = await supabase.rpc('reset_user_data')
    if (error) {
      toast('Failed to reset data.', 'error')
      return { success: false, error: error.message }
    }

    setProjects([])
    setIncidents([])
    setIncidentsPage([])
    setPagination({ page: 1, limit: 10, totalCount: 0 })
    return { success: true }
  }, [supabase, toast])

  const addComponent = useCallback(async (projectId: string, name: string) => {
    try {
      const snapshot = createSnapshot({ projects, incidents })

      const { data, error } = await supabase
        .from('components')
        .insert([{ project_id: projectId, name, status: 'operational' }])
        .select()
        .single()

      if (error) {
        restoreSnapshot(snapshot)
        toast(error.message, 'error')
        addError(error.message)
        return { success: false, error: error.message }
      }

      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, components: [...(p.components || []), data as Component] }
            : p
        )
      )
      return { success: true, component: data as Component }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      toast(errorMsg, 'error')
      addError(errorMsg)
      return { success: false, error: errorMsg }
    }
  }, [supabase, projects, incidents, toast, addError])

  const updateComponentStatus = useCallback(async (componentId: string, projectId: string, status: string) => {
    const snapshot = createSnapshot({ projects, incidents })
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

    const response = await fetch(`/api/components/${componentId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, status }),
    })
    if (!response.ok) {
      restoreSnapshot(snapshot)
      const message = await readApiError(response)
      toast(message, 'error')
      addError(message)
      return { success: false, error: message }
    }

    return { success: true }
  }, [supabase, projects, incidents, toast, addError])

  const deleteComponent = useCallback(async (componentId: string, projectId: string) => {
    const snapshot = createSnapshot({ projects, incidents })

    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, components: p.components.filter((c) => c.id !== componentId) }
          : p
      )
    )

    const { error } = await supabase.from('components').delete().eq('id', componentId)
    if (error) {
      restoreSnapshot(snapshot)
      toast(error.message, 'error')
      addError(error.message)
      return { success: false, error: error.message }
    }

    return { success: true }
  }, [supabase, projects, incidents, toast, addError])

  const addIncident = useCallback(async (data: {
    projectId: string
    title: string
    description: string
    status: string
    severity: string
    components: string[]
  }) => {
    try {
      const snapshot = createSnapshot({ projects, incidents })

      const response = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: data.projectId,
          title: data.title,
          description: data.description,
          status: data.status,
          severity: data.severity,
          component_ids: data.components,
        }),
      })
      if (!response.ok) {
        restoreSnapshot(snapshot)
        const message = await readApiError(response)
        toast(message, 'error')
        addError(message)
        return { success: false, error: message }
      }

      const result = await response.json() as IncidentMutationResponse
      const newIncident = result.incident

      setIncidents((prev) => [newIncident, ...prev])
      if (result.component_updates.length > 0) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === data.projectId
              ? {
                  ...p,
                  components: p.components.map((c) => {
                    const componentUpdate = result.component_updates.find((update) => update.id === c.id)
                    return componentUpdate ? { ...c, status: componentUpdate.status } : c
                  }),
                }
              : p
          )
        )
      }

      if (result.alert.warning) console.warn('[alerts] incident alert warning:', result.alert.warning)

      return { success: true, incident: newIncident }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      toast(errorMsg, 'error')
      addError(errorMsg)
      return { success: false, error: errorMsg }
    }
  }, [projects, incidents, toast, addError])

  const updateIncident = useCallback(async (id: string, updates: Record<string, unknown>, message?: string) => {
    const snapshot = createSnapshot({ projects, incidents })

    setIncidents((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i
        const updated = { ...i, ...updates } as Incident
        return updated
      })
    )

    const response = await fetch(`/api/incidents/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates, message }),
    })
    if (!response.ok) {
      restoreSnapshot(snapshot)
      const apiError = await readApiError(response)
      toast(apiError, 'error')
      addError(apiError)
      return { success: false, error: apiError }
    }

    const result = await response.json() as IncidentMutationResponse
    const newHistoryItem = result.incident_update

    if (newHistoryItem) {
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
    }
    if (result.component_updates.length > 0) {
      setProjects((prev) =>
        prev.map((p) => ({
          ...p,
          components: p.components.map((c) => {
            const componentUpdate = result.component_updates.find((update) => update.id === c.id)
            return componentUpdate ? { ...c, status: componentUpdate.status } : c
          }),
        }))
      )
    }

    if (result.alert.warning) console.warn('[alerts] incident alert warning:', result.alert.warning)

    return { success: true }
  }, [projects, incidents, toast, addError])

  const deleteIncident = useCallback(async (id: string) => {
    const snapshot = createSnapshot({ projects, incidents })

    setIncidents((prev) => prev.filter((i) => i.id !== id))

    const { error } = await supabase.from('incidents').delete().eq('id', id)
    if (error) {
      restoreSnapshot(snapshot)
      toast(error.message, 'error')
      addError(error.message)
      return { success: false, error: error.message }
    }

    return { success: true }
  }, [supabase, projects, incidents, toast, addError])

  const getProjectById = useCallback((id: string) => projects.find((p) => p.id === id), [projects])
  const getProjectBySlug = useCallback((slug: string) => projects.find((p) => p.slug === slug), [projects])
  const getIncidentsByProject = useCallback((projectId: string) => incidents.filter((i) => i.project_id === projectId), [incidents])
  const getIncidentById = useCallback((id: string) => incidents.find((i) => i.id === id), [incidents])

  return (
    <StoreContext.Provider
      value={{
        projects,
        incidents,
        isLoading,
        errors,
        isOffline,
        // Pagination state
        pagination,
        filters,
        incidentsPage,
        isPaginating,
        // Pagination actions
        setFilters,
        setPage,
        fetchIncidentsPage,
        addError,
        clearErrors,
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
        getDeduplicatedComponentNames,
        refreshData: loadData,
        resetAllData,
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}

export function useStore(): StoreContextType {
  const context = useContext(StoreContext)
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider')
  }
  return context
}

async function readApiError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null)
  if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') return body.error
  return 'Request failed.'
}

interface IncidentComponentUpdate {
  id: string
  status: ComponentStatus
}

interface IncidentMutationAlertResult {
  queued: boolean
  warning: string | null
}

interface IncidentMutationResponse {
  incident: Incident
  incident_update?: IncidentUpdate | null
  component_updates: IncidentComponentUpdate[]
  alert: IncidentMutationAlertResult
}
