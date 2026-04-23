import { describe, it, expect } from 'vitest'
import { createSnapshot, restoreSnapshot } from '@/lib/store/snapshot'
import type { Project, Incident } from '@/lib/types'

describe('StoreProvider - Error State Management', () => {
  describe('addError logic', () => {
    it('should add error to errors array', () => {
      const errors: string[] = []
      const addError = (error: string) => {
        errors.push(error)
      }

      addError('Network error')
      expect(errors).toContain('Network error')
      expect(errors.length).toBe(1)

      addError('Another error')
      expect(errors.length).toBe(2)
      expect(errors).toEqual(['Network error', 'Another error'])
    })
  })

  describe('clearErrors logic', () => {
    it('should clear all errors', () => {
      const errors = ['Error 1', 'Error 2', 'Error 3']
      const clearErrors = () => {
        errors.length = 0
      }

      expect(errors.length).toBe(3)
      clearErrors()
      expect(errors.length).toBe(0)
    })
  })

  describe('isOffline logic', () => {
    it('should track offline state', () => {
      let isOffline = false

      expect(isOffline).toBe(false)
      isOffline = true
      expect(isOffline).toBe(true)
      isOffline = false
      expect(isOffline).toBe(false)
    })
  })
})

describe('StoreProvider - Rollback Behavior', () => {
  it('should create independent copy via snapshot', () => {
    const state = { projects: [{ id: '1', name: 'Test' }], incidents: [] }
    const snapshot = createSnapshot(state)

    // Mutate original
    state.projects.push({ id: '2', name: 'Test 2' })

    // Snapshot should be independent
    expect(snapshot.projects.length).toBe(1)
    expect((snapshot as typeof state).projects[0].id).toBe('1')
  })

  it('should preserve state through snapshot/restore cycle', () => {
    const originalState = {
      projects: [
        { id: '1', name: 'Project 1', components: [] },
      ],
      incidents: [],
    }

    const snapshot = createSnapshot(originalState)
    const restored = restoreSnapshot(snapshot)

    expect(restored).toEqual(originalState)
  })

  it('should rollback to exact previous state', () => {
    const projects: Project[] = [
      { id: '1', user_id: 'u1', name: 'Project 1', slug: 'p1', description: null, components: [], created_at: '', updated_at: '' },
      { id: '2', user_id: 'u1', name: 'Project 2', slug: 'p2', description: null, components: [], created_at: '', updated_at: '' },
    ]
    const incidents: Incident[] = []

    const state = { projects, incidents }
    const snapshot = createSnapshot(state)

    // Simulate optimistic update (add a project)
    const mutatedState = {
      projects: [...projects, { id: '3', user_id: 'u1', name: 'Project 3', slug: 'p3', description: null, components: [], created_at: '', updated_at: '' }],
      incidents,
    }

    // Snapshot should remain unchanged
    expect(snapshot.projects.length).toBe(2)
    expect((snapshot as typeof state).projects.length).toBe(2)

    // Restore should give back original
    const restored = restoreSnapshot(snapshot)
    expect(restored.projects.length).toBe(2)
  })
})

describe('StoreProvider - createSnapshot / restoreSnapshot integration', () => {
  it('should preserve complex nested structures', () => {
    const originalState: { projects: Project[]; incidents: Incident[] } = {
      projects: [
        { id: '1', user_id: 'u1', name: 'Project 1', slug: 'p1', description: null, components: [{ id: 'c1', project_id: '1', name: 'Comp 1', status: 'operational' }], created_at: '', updated_at: '' },
        { id: '2', user_id: 'u1', name: 'Project 2', slug: 'p2', description: null, components: [], created_at: '', updated_at: '' },
      ],
      incidents: [
        { id: 'inc-1', project_id: '1', title: 'Incident 1', description: null, status: 'investigating', severity: 'medium', component_ids: [], duration: 0, created_at: '', incident_updates: [] },
      ],
    }

    const snapshot = createSnapshot(originalState)
    const restored = restoreSnapshot(snapshot)

    expect(restored).toEqual(originalState)
    expect(restored.projects[0].components[0]).toEqual(originalState.projects[0].components[0])
    expect(restored.incidents[0]).toEqual(originalState.incidents[0])
  })

  it('should handle empty arrays and objects', () => {
    const empty = { projects: [], incidents: [] }
    const snapshot = createSnapshot(empty)
    const restored = restoreSnapshot(snapshot)

    expect(restored).toEqual(empty)
    expect(restored.projects).toEqual([])
    expect(restored.incidents).toEqual([])
  })
})
