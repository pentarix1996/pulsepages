import { auth } from '../auth.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { escapeHTML } from '../utils/security.js';
import { formatDateTime } from '../utils/helpers.js';
import { filterIncidentsByPlan } from '../utils/plan-limits.js';

export function renderIncidents() {
  const user = auth.getCurrentUser();
  if (!user) return '';

  const projects = store.getProjects(user.id);
  const allIncidents = [];

  projects.forEach(project => {
    const incidents = store.getIncidents(project.id);
    incidents.forEach(inc => {
      allIncidents.push({ ...inc, projectName: project.name, projectSlug: project.slug, projectComponents: project.components });
    });
  });

  const filteredIncidents = filterIncidentsByPlan(allIncidents, user.plan);
  filteredIncidents.sort((a, b) => new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at));

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Incidents</h1>
        <p class="page-description">View and manage all incidents across your projects.</p>
      </div>
    </div>

    ${filteredIncidents.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <h3 class="empty-state-title">No incidents</h3>
        <p class="empty-state-description">All systems are running smoothly. No incidents to report.</p>
      </div>
    ` : `
      <div class="incident-timeline">
        ${filteredIncidents.map(inc => {
          const compNames = (inc.component_ids || inc.components || [])
            .map(cid => {
              const comp = (inc.projectComponents || []).find(c => c.id === cid);
              return comp ? escapeHTML(comp.name) : null;
            })
            .filter(Boolean);

          return `
            <div class="incident-item">
              <div class="incident-dot incident-dot-${inc.status === 'resolved' ? 'resolved' : inc.severity === 'danger' ? 'danger' : inc.severity === 'warning' ? 'warning' : 'info'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  ${inc.status === 'resolved'
                    ? '<polyline points="20 6 9 17 4 12"></polyline>'
                    : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'}
                </svg>
              </div>
              <div class="incident-content">
                <div style="display:flex;align-items:center;gap:var(--space-8);flex-wrap:wrap;">
                  <span class="incident-title">${escapeHTML(inc.title)}</span>
                  <span class="badge badge-${inc.status === 'resolved' ? 'success' : inc.severity === 'danger' ? 'danger' : inc.severity === 'warning' ? 'warning' : 'info'}">${escapeHTML(inc.status)}</span>
                  <span class="pill" style="cursor:pointer;" data-goto-project="${escapeHTML(inc.projectId || inc.project_id)}">${escapeHTML(inc.projectName)}</span>
                  ${compNames.map(n => `<span class="badge badge-neutral">${n}</span>`).join('')}
                </div>
                <div class="incident-meta">${formatDateTime(inc.createdAt || inc.created_at)}</div>
                ${inc.description ? `<p class="incident-description">${escapeHTML(inc.description)}</p>` : ''}
                ${(inc.incident_updates || inc.updates || []).sort((a,b) => new Date(b.created_at || b.createdAt).getTime() - new Date(a.created_at || a.createdAt).getTime()).map(u => `
                  <div style="margin-top:var(--space-8);padding-left:var(--space-12);border-left:2px solid var(--border-secondary);">
                    <p style="font-size:0.8125rem;color:var(--text-tertiary);">${escapeHTML(u.message)}</p>
                    <span style="font-size:0.75rem;color:var(--text-quaternary);">${new Date(u.createdAt || u.created_at).toLocaleString()} — ${escapeHTML(u.status)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

export function initIncidents() {
  document.querySelectorAll('[data-goto-project]').forEach(el => {
    el.addEventListener('click', () => {
      router.navigate(`/project/${el.dataset.gotoProject}`);
    });
  });
}
