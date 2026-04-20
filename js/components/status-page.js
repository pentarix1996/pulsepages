import { supabase } from '../supabase.js';
import { escapeHTML } from '../utils/security.js';
import { getOverallStatus, getStatusLabel, getStatusDotClass, getStatusColor, uptimePercentage, formatDateTime } from '../utils/helpers.js';
import { filterIncidentsByPlan } from '../utils/plan-limits.js';

export async function renderStatusPage(params) {
  const { data: project, error } = await supabase
    .from('projects')
    .select(`
      *,
      profiles(plan),
      components(*),
      incidents(
        *,
        incident_updates(*)
      )
    `)
    .eq('slug', params.slug)
    .single();

  if (error || !project) {
    return `
      <div class="status-page-public">
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          </div>
          <h3 class="empty-state-title">Page not found</h3>
          <p class="empty-state-description">This status page doesn't exist or has been removed.</p>
          <a href="#/" class="btn btn-primary">Go Home</a>
        </div>
      </div>
    `;
  }

  const plan = project.profiles?.plan || 'free';
  const components = project.components || [];

  const overallStatus = getOverallStatus(components);
  const allIncidents = project.incidents || [];
  
  // Sort incidents locally so they look right (descending)
  allIncidents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  components.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const incidents = filterIncidentsByPlan(allIncidents, plan);
  
  const uptime = uptimePercentage(incidents);
  const activeIncidents = incidents.filter(i => i.status !== 'resolved');
  const recentResolved = incidents.filter(i => i.status === 'resolved').slice(0, 5);

  const overallStatusClass = overallStatus === 'operational' ? 'operational'
    : overallStatus === 'degraded' ? 'degraded'
    : overallStatus === 'maintenance' ? 'maintenance' : 'down';

  const overallStatusText = overallStatus === 'operational' ? 'All Systems Operational'
    : overallStatus === 'degraded' ? 'Degraded Performance'
    : overallStatus === 'maintenance' ? 'Maintenance In Progress'
    : 'System Outage';

  return `
    <div class="status-page-public">
      <div class="status-page-header">
        <div class="status-page-logo">
          <div class="status-page-logo-icon">${escapeHTML(project.name.charAt(0).toUpperCase())}</div>
          <span class="status-page-logo-name">${escapeHTML(project.name)}</span>
        </div>

        <div class="status-page-overall status-page-overall-${overallStatusClass}">
          <span class="status-dot status-dot-${getStatusDotClass(overallStatus)} status-dot-pulse"></span>
          <span class="status-page-overall-text">${overallStatusText}</span>
        </div>
        <div class="status-page-uptime">${uptime}% uptime based on incident history</div>
      </div>

      ${components.length > 0 ? `
        <div class="status-page-section-title">Current Status</div>
        <div class="status-page-components">
          ${components.map(comp => {
            const color = getStatusColor(comp.status);
            return `
              <div class="status-page-component">
                <span class="status-page-component-name">${escapeHTML(comp.name)}</span>
                <span class="status-page-component-status" style="color:var(--status-${color === 'success' ? 'emerald' : color === 'warning' ? 'yellow' : color === 'danger' ? 'red' : color === 'info' ? 'blue' : ''})">
                  <span class="status-dot ${getStatusDotClass(comp.status)}"></span>
                  ${getStatusLabel(comp.status)}
                </span>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      ${activeIncidents.length > 0 ? `
        <div class="status-page-section-title">Active Incidents</div>
        <div class="status-page-incidents">
          <div class="incident-timeline">
            ${activeIncidents.map(inc => {
              const compNames = (inc.components || [])
                .map(cid => {
                  const comp = components.find(c => c.id === cid);
                  return comp ? escapeHTML(comp.name) : null;
                })
                .filter(Boolean);
              return `
                <div class="incident-item">
                  <div class="incident-dot incident-dot-${inc.severity === 'danger' ? 'danger' : inc.severity === 'warning' ? 'warning' : 'info'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  </div>
                  <div class="incident-content">
                    <div style="display:flex;align-items:center;gap:var(--space-8);flex-wrap:wrap;margin-bottom:var(--space-4);">
                      <span class="incident-title">${escapeHTML(inc.title)}</span>
                      ${compNames.map(n => `<span class="badge badge-neutral">${n}</span>`).join('')}
                    </div>
                    <div class="incident-meta">${formatDateTime(inc.createdAt || inc.created_at)}</div>
                    ${inc.description ? `<p class="incident-description">${escapeHTML(inc.description)}</p>` : ''}
                    ${(inc.incident_updates || inc.updates || []).sort((a,b) => new Date(b.created_at || b.createdAt).getTime() - new Date(a.created_at || a.createdAt).getTime()).map(u => `
                      <div style="margin-top:var(--space-8);padding-left:var(--space-12);border-left:2px solid var(--border-secondary);">
                        <p style="font-size:0.8125rem;color:var(--text-tertiary);">${escapeHTML(u.message)}</p>
                        <span style="font-size:0.75rem;color:var(--text-quaternary);">${formatDateTime(u.createdAt || u.created_at)} — ${escapeHTML(u.status)}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${recentResolved.length > 0 ? `
        <div class="status-page-section-title">Past Incidents</div>
        <div class="status-page-incidents">
          <div class="incident-timeline">
            ${recentResolved.map(inc => {
              const compNames = (inc.components || [])
                .map(cid => {
                  const comp = components.find(c => c.id === cid);
                  return comp ? escapeHTML(comp.name) : null;
                })
                .filter(Boolean);
              return `
                <div class="incident-item">
                  <div class="incident-dot incident-dot-resolved">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <div class="incident-content">
                    <div style="display:flex;align-items:center;gap:var(--space-8);flex-wrap:wrap;margin-bottom:var(--space-4);">
                      <span class="incident-title">${escapeHTML(inc.title)}</span>
                      <span class="badge badge-success">Resolved</span>
                      ${compNames.map(n => `<span class="badge badge-neutral">${n}</span>`).join('')}
                    </div>
                    <div class="incident-meta">${formatDateTime(inc.createdAt || inc.created_at)}</div>
                    ${inc.description ? `<p class="incident-description">${escapeHTML(inc.description)}</p>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div class="status-page-powered">
        Powered by <a href="#/">PulsePages</a>
      </div>
    </div>
  `;
}
