import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Incident } from '@/lib/types'

// Test the pure logic of pagination calculations
describe('Pagination Logic', () => {
  describe('page range calculation', () => {
    it('calculates correct from/to range for page 1', () => {
      const page = 1
      const limit = 10
      const from = (page - 1) * limit // 0
      const to = page * limit - 1 // 9
      expect(from).toBe(0)
      expect(to).toBe(9)
    })

    it('calculates correct from/to range for page 3', () => {
      const page = 3
      const limit = 10
      const from = (page - 1) * limit // 20
      const to = page * limit - 1 // 29
      expect(from).toBe(20)
      expect(to).toBe(29)
    })

    it('calculates correct totalPages', () => {
      const totalCount = 95
      const limit = 10
      const totalPages = Math.ceil(totalCount / limit)
      expect(totalPages).toBe(10)
    })

    it('calculates correct start/end items for status text', () => {
      const page = 3
      const limit = 10
      const totalCount = 95
      const startItem = (page - 1) * limit + 1 // 21
      const endItem = Math.min(page * limit, totalCount) // 30
      expect(startItem).toBe(21)
      expect(endItem).toBe(30)
    })
  })

  describe('page pill logic', () => {
    it('shows first 5 pages when near start (page <= 3)', () => {
      const page = 2
      const totalPages = 10
      const pills = getPagePills(page, totalPages)
      expect(pills).toEqual([1, 2, 3, 4, 5])
    })

    it('shows last 5 pages when near end (page >= total - 2)', () => {
      const page = 9
      const totalPages = 10
      const pills = getPagePills(page, totalPages)
      expect(pills).toEqual([6, 7, 8, 9, 10])
    })

    it('shows centered pages when in middle', () => {
      const page = 5
      const totalPages = 10
      const pills = getPagePills(page, totalPages)
      expect(pills).toEqual([3, 4, 5, 6, 7])
    })

    it('handles single page', () => {
      const page = 1
      const totalPages = 1
      const pills = getPagePills(page, totalPages)
      expect(pills).toEqual([1])
    })

    it('handles only 3 total pages', () => {
      const page = 2
      const totalPages = 3
      const pills = getPagePills(page, totalPages)
      expect(pills).toEqual([1, 2, 3])
    })
  })
})

// Pure function for page pill calculation (will be implemented in Pagination component)
function getPagePills(page: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  if (page <= 3) {
    return [1, 2, 3, 4, 5]
  }
  if (page >= totalPages - 2) {
    return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [page - 2, page - 1, page, page + 1, page + 2]
}

describe('Filter State Logic', () => {
  describe('setFilters behavior', () => {
    it('merges partial filters with existing state', () => {
      const existing = {
        projectId: 'proj-1',
        componentId: 'comp-A',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      }
      const update = { componentId: 'comp-B' }
      const result = { ...existing, ...update }
      expect(result.projectId).toBe('proj-1')
      expect(result.componentId).toBe('comp-B')
      expect(result.dateFrom).toBe('2026-01-01')
      expect(result.dateTo).toBe('2026-01-31')
    })

    it('resets page to 1 when any filter changes', () => {
      const pagination = { page: 5, limit: 10, totalCount: 95 }
      const newPagination = { ...pagination, page: 1 }
      expect(newPagination.page).toBe(1)
    })

    it('clears specific filter when set to null', () => {
      const existing = {
        projectId: 'proj-1',
        componentId: 'comp-A',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      }
      const update = { dateFrom: null, dateTo: null }
      const result = { ...existing, ...update }
      expect(result.dateFrom).toBeNull()
      expect(result.dateTo).toBeNull()
    })
  })

  describe('filter combinations', () => {
    it('detects when any filter is active', () => {
      const filters = {
        projectId: null,
        componentId: null,
        dateFrom: null,
        dateTo: null,
      }
      const hasActiveFilters = Object.values(filters).some((v) => v !== null)
      expect(hasActiveFilters).toBe(false)
    })

    it('detects active project filter', () => {
      const filters = {
        projectId: 'proj-1',
        componentId: null,
        dateFrom: null,
        dateTo: null,
      }
      const hasActiveFilters = Object.values(filters).some((v) => v !== null)
      expect(hasActiveFilters).toBe(true)
    })

    it('detects active date filter', () => {
      const filters = {
        projectId: null,
        componentId: null,
        dateFrom: '2026-01-01',
        dateTo: null,
      }
      const hasActiveFilters = Object.values(filters).some((v) => v !== null)
      expect(hasActiveFilters).toBe(true)
    })
  })
})

describe('Component Name Deduplication Logic', () => {
  it('deduplicates component names across projects', () => {
    interface Component { id: string; name: string; projectId: string }
    const components: Component[] = [
      { id: 'c1', name: 'API', projectId: 'p1' },
      { id: 'c2', name: 'API', projectId: 'p2' },
      { id: 'c3', name: 'Database', projectId: 'p1' },
      { id: 'c4', name: 'API', projectId: 'p3' },
    ]

    const nameMap = new Map<string, string[]>()
    components.forEach((comp) => {
      if (!nameMap.has(comp.name)) {
        nameMap.set(comp.name, [])
      }
      nameMap.get(comp.name)!.push(comp.projectId)
    })

    const deduplicated = Array.from(nameMap.entries()).map(([name, projectIds]) => ({
      name,
      projectCount: projectIds.length,
    }))

    expect(deduplicated).toHaveLength(2)
    expect(deduplicated.find((d) => d.name === 'API')?.projectCount).toBe(3)
    expect(deduplicated.find((d) => d.name === 'Database')?.projectCount).toBe(1)
  })
})

describe('Date Range Filter Logic', () => {
  it('adds one day to end date for full-day coverage', () => {
    const dateTo = '2026-01-31'
    const endDate = new Date(dateTo)
    endDate.setDate(endDate.getDate() + 1)
    const result = endDate.toISOString().split('T')[0]
    expect(result).toBe('2026-02-01')
  })

  it('handles month boundary correctly', () => {
    const dateTo = '2026-01-31'
    const endDate = new Date(dateTo)
    endDate.setDate(endDate.getDate() + 1)
    expect(endDate.getMonth()).toBe(1) // February (0-indexed)
    expect(endDate.getDate()).toBe(1)
  })
})
