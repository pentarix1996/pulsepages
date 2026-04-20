import type { Plan, Project, Incident } from '@/lib/types'

interface PlanLimits {
  maxProjects: number
  maxComponentsPerProject: number
  historyDays: number
}

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxProjects: 1, maxComponentsPerProject: 3, historyDays: 7 },
  pro: { maxProjects: 5, maxComponentsPerProject: 10, historyDays: 90 },
  business: { maxProjects: -1, maxComponentsPerProject: -1, historyDays: 365 },
}

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free
}

interface LimitCheckResult {
  allowed: boolean
  message: string
}

export function canCreateProject(plan: Plan, currentProjectCount: number): LimitCheckResult {
  const limits = getPlanLimits(plan)
  if (limits.maxProjects === -1) return { allowed: true, message: '' }

  if (currentProjectCount >= limits.maxProjects) {
    return {
      allowed: false,
      message: `Your ${plan} plan allows ${limits.maxProjects} project${limits.maxProjects === 1 ? '' : 's'}. Upgrade to add more.`,
    }
  }

  return { allowed: true, message: '' }
}

export function canAddComponent(plan: Plan, currentComponentCount: number): LimitCheckResult {
  const limits = getPlanLimits(plan)
  if (limits.maxComponentsPerProject === -1) return { allowed: true, message: '' }

  if (currentComponentCount >= limits.maxComponentsPerProject) {
    return {
      allowed: false,
      message: `Your ${plan} plan allows ${limits.maxComponentsPerProject} components per project. Upgrade to add more.`,
    }
  }

  return { allowed: true, message: '' }
}

export function filterIncidentsByPlan(incidents: Incident[], plan: Plan): Incident[] {
  const limits = getPlanLimits(plan)
  const cutoff = Date.now() - limits.historyDays * 24 * 60 * 60 * 1000

  return incidents.filter((inc) => {
    return new Date(inc.created_at).getTime() >= cutoff
  })
}
