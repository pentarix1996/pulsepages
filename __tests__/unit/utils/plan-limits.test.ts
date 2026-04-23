import { describe, it, expect } from 'vitest'
import {
  getPlanLimits,
  canCreateProject,
  canAddComponent,
  filterIncidentsByPlan,
} from '@/lib/utils/plan-limits'
import type { Incident } from '@/lib/types'

describe('getPlanLimits', () => {
  it('returns correct limits for free plan', () => {
    const limits = getPlanLimits('free')
    expect(limits.maxProjects).toBe(1)
    expect(limits.maxComponentsPerProject).toBe(3)
    expect(limits.historyDays).toBe(7)
  })

  it('returns correct limits for pro plan', () => {
    const limits = getPlanLimits('pro')
    expect(limits.maxProjects).toBe(5)
    expect(limits.maxComponentsPerProject).toBe(10)
    expect(limits.historyDays).toBe(90)
  })

  it('returns correct limits for business plan', () => {
    const limits = getPlanLimits('business')
    expect(limits.maxProjects).toBe(-1)
    expect(limits.maxComponentsPerProject).toBe(-1)
    expect(limits.historyDays).toBe(365)
  })

  it('defaults to free for unknown plan', () => {
    const limits = getPlanLimits('unknown' as never)
    expect(limits.maxProjects).toBe(1)
  })
})

describe('canCreateProject', () => {
  it('allows free user with 0 projects', () => {
    expect(canCreateProject('free', 0).allowed).toBe(true)
  })

  it('blocks free user with 1 project', () => {
    const result = canCreateProject('free', 1)
    expect(result.allowed).toBe(false)
    expect(result.message).toContain('1 project')
  })

  it('allows pro user with 4 projects', () => {
    expect(canCreateProject('pro', 4).allowed).toBe(true)
  })

  it('blocks pro user with 5 projects', () => {
    expect(canCreateProject('pro', 5).allowed).toBe(false)
  })

  it('always allows business users', () => {
    expect(canCreateProject('business', 100).allowed).toBe(true)
  })
})

describe('canAddComponent', () => {
  it('allows free user with 2 components', () => {
    expect(canAddComponent('free', 2).allowed).toBe(true)
  })

  it('blocks free user with 3 components', () => {
    const result = canAddComponent('free', 3)
    expect(result.allowed).toBe(false)
    expect(result.message).toContain('3 components')
  })

  it('always allows business users', () => {
    expect(canAddComponent('business', 999).allowed).toBe(true)
  })
})

describe('filterIncidentsByPlan', () => {
  const makeIncident = (daysAgo: number): Incident => ({
    id: `inc-${daysAgo}`,
    project_id: 'p1',
    title: `Incident ${daysAgo}d ago`,
    description: null,
    status: 'resolved',
    severity: 'medium',
    component_ids: [],
    duration: 30,
    created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    incident_updates: [],
  })

  it('filters incidents older than free plan limit (7 days)', () => {
    const incidents = [makeIncident(3), makeIncident(10)]
    const result = filterIncidentsByPlan(incidents, 'free')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('inc-3')
  })

  it('keeps more incidents for pro plan (90 days)', () => {
    const incidents = [makeIncident(3), makeIncident(30), makeIncident(100)]
    const result = filterIncidentsByPlan(incidents, 'pro')
    expect(result.length).toBe(2)
  })

  it('keeps all recent incidents for business plan (365 days)', () => {
    const incidents = [makeIncident(3), makeIncident(100), makeIncident(300)]
    const result = filterIncidentsByPlan(incidents, 'business')
    expect(result.length).toBe(3)
  })
})
