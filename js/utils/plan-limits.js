import { store } from '../store.js';
import { auth } from '../auth.js';

const PLAN_LIMITS = {
  free: { maxProjects: 1, maxComponentsPerProject: 3, historyDays: 7 },
  pro: { maxProjects: 5, maxComponentsPerProject: 10, historyDays: 90 },
  business: { maxProjects: -1, maxComponentsPerProject: -1, historyDays: 365 }
};

export function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export function canCreateProject(userId) {
  const user = auth.getCurrentUser();
  if (!user || user.id !== userId) return { allowed: false, message: 'User not found.' };

  const limits = getPlanLimits(user.plan);
  if (limits.maxProjects === -1) return { allowed: true, message: '' };

  const projects = store.getProjects(userId);
  if (projects.length >= limits.maxProjects) {
    return {
      allowed: false,
      message: `Your ${user.plan} plan allows ${limits.maxProjects} project${limits.maxProjects === 1 ? '' : 's'}. Upgrade to add more.`
    };
  }

  return { allowed: true, message: '' };
}

export function canAddComponent(projectId) {
  const project = store.getProjectById(projectId);
  if (!project) return { allowed: false, message: 'Project not found.' };

  const user = auth.getCurrentUser();
  const projectUserId = project.user_id || project.userId;
  if (!user || projectUserId !== user.id) return { allowed: false, message: 'User not found or unauthorized.' };

  const limits = getPlanLimits(user.plan);
  if (limits.maxComponentsPerProject === -1) return { allowed: true, message: '' };

  if (project.components.length >= limits.maxComponentsPerProject) {
    return {
      allowed: false,
      message: `Your ${user.plan} plan allows ${limits.maxComponentsPerProject} components per project. Upgrade to add more.`
    };
  }

  return { allowed: true, message: '' };
}

export function filterIncidentsByPlan(incidents, plan) {
  const limits = getPlanLimits(plan);
  const cutoff = Date.now() - (limits.historyDays * 24 * 60 * 60 * 1000);

  return incidents.filter(inc => {
    const dateStr = inc.created_at || inc.createdAt;
    return new Date(dateStr).getTime() >= cutoff;
  });
}
