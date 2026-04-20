import { auth } from '../auth.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { escapeHTML } from '../utils/security.js';
import { getOverallStatus, getStatusLabel, getStatusDotClass, timeAgo, uptimePercentage } from '../utils/helpers.js';
import { canCreateProject, getPlanLimits } from '../utils/plan-limits.js';

export function renderDashboard() {
  const user = auth.getCurrentUser();
  if (!user) return '';

  const projects = store.getProjects(user.id);
  const incidents = store.getIncidents();
  const userIncidents = incidents.filter(i => projects.some(p => p.id === i.projectId));

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Projects</h1>
        <p class="page-description">Manage your status pages and monitor your services.</p>
      </div>
      <button class="btn btn-primary" id="dashboard-new-project">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        New Project
      </button>
    </div>

    <div class="projects-grid" id="projects-grid">
      ${projects.map(project => {
        const overallStatus = getOverallStatus(project.components);
        const projectIncidents = incidents.filter(i => i.projectId === project.id);
        const uptime = uptimePercentage(projectIncidents);
        const activeIncidents = projectIncidents.filter(i => i.status !== 'resolved').length;

        return `
          <div class="project-card" data-project-id="${escapeHTML(project.id)}" id="project-${escapeHTML(project.id)}">
            <div class="project-card-header">
              <div>
                <h3 class="project-card-title">${escapeHTML(project.name)}</h3>
                <span class="project-card-slug">/${escapeHTML(project.slug)}</span>
              </div>
              <div class="project-card-icon">
                <span class="status-dot ${getStatusDotClass(overallStatus)} status-dot-pulse"></span>
              </div>
            </div>
            <p style="font-size:0.8125rem;color:var(--text-tertiary);margin-bottom:var(--space-8);">${escapeHTML(project.description || '')}</p>
            <div class="project-card-stats">
              <div class="project-card-stat">
                <span class="project-card-stat-value">${project.components.length}</span>
                <span class="project-card-stat-label">Components</span>
              </div>
              <div class="project-card-stat">
                <span class="project-card-stat-value">${uptime}%</span>
                <span class="project-card-stat-label">Uptime</span>
              </div>
              <div class="project-card-stat">
                <span class="project-card-stat-value">${activeIncidents}</span>
                <span class="project-card-stat-label">Active</span>
              </div>
              <div class="project-card-stat">
                <span class="project-card-stat-value">${timeAgo(project.updatedAt)}</span>
                <span class="project-card-stat-label">Updated</span>
              </div>
            </div>
          </div>
        `;
      }).join('')}

      <div class="project-card-new" id="dashboard-new-card">
        <div class="project-card-new-icon">+</div>
        <span class="project-card-new-text">Create new project</span>
      </div>
    </div>

    ${(user.plan === 'pro' || user.plan === 'business') ? `
      <div class="page-header" style="margin-top:var(--space-32);">
        <div>
          <h2 class="page-title" style="font-size:1.125rem;">API Documentation</h2>
          <p class="page-description">Automate your status pages using our REST API.</p>
        </div>
      </div>
      
      <div class="card" style="margin-bottom:var(--space-24);">
        <h3 style="font-size:0.9375rem;font-weight:var(--fw-medium);margin-bottom:var(--space-8);">Update Component Status</h3>
        <p style="font-size:0.8125rem;color:var(--text-tertiary);margin-bottom:var(--space-12);">Automatically update a component's status from your CI/CD pipeline or monitoring tools.</p>
        
        <div style="background-color:var(--bg-tertiary);padding:var(--space-12);border-radius:var(--radius-4);margin-bottom:var(--space-12);overflow-x:auto;">
          <pre><code style="font-size:0.8125rem;color:var(--text-secondary);font-family:monospace;">curl -X PATCH https://api.pulsepages.dev/v1/projects/{project_id}/components/{component_id} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "degraded"}'</code></pre>
        </div>
        <p style="font-size:0.8125rem;color:var(--text-tertiary);">Status values: <span class="badge">operational</span> <span class="badge">degraded</span> <span class="badge">partial_outage</span> <span class="badge">major_outage</span> <span class="badge">maintenance</span></p>
      </div>
    ` : ''}
  `;
}

export function initDashboard() {
  const newProjectBtn = document.getElementById('dashboard-new-project');
  const newProjectCard = document.getElementById('dashboard-new-card');

  const handleNew = () => {
    const user = auth.getCurrentUser();
    if (!user) return;
    const check = canCreateProject(user.id);
    if (!check.allowed) {
      showDashboardToast(check.message);
      return;
    }
    router.navigate('/project/new');
  };

  if (newProjectBtn) newProjectBtn.addEventListener('click', handleNew);
  if (newProjectCard) newProjectCard.addEventListener('click', handleNew);

  document.querySelectorAll('.project-card[data-project-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.projectId;
      router.navigate(`/project/${id}`);
    });
  });
}

function showDashboardToast(message) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span class="toast-icon" style="color:var(--status-yellow);">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
    </span>
    <div class="toast-content">
      <div class="toast-title">Plan limit reached</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
