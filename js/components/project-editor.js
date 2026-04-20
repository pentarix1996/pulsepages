import { auth } from '../auth.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { escapeHTML, sanitizeInput, validateSlug } from '../utils/security.js';
import { generateId, slugify, getStatusLabel, getStatusDotClass, getStatusColor } from '../utils/helpers.js';
import { canCreateProject, canAddComponent } from '../utils/plan-limits.js';

export function renderProjectEditor(params) {
  const user = auth.getCurrentUser();
  if (!user) return '';

  const isNew = params.id === 'new';
  const project = isNew ? null : store.getProjectById(params.id);

  if (!isNew && !project) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        </div>
        <h3 class="empty-state-title">Project not found</h3>
        <p class="empty-state-description">This project doesn't exist or you don't have access.</p>
        <button class="btn btn-primary" onclick="location.hash='/dashboard'">Back to Dashboard</button>
      </div>
    `;
  }

  if (isNew) {
    return renderNewProjectForm();
  }

  return renderEditProjectView(project);
}

function renderNewProjectForm() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Create Project</h1>
        <p class="page-description">Set up a new status page for your service.</p>
      </div>
    </div>
    <div class="editor-layout" style="max-width:640px;">
      <div class="editor-section">
        <div class="editor-section-header">
          <h2 class="editor-section-title">Project Details</h2>
        </div>
        <div class="editor-section-body">
          <form id="new-project-form" class="auth-form">
            <div class="input-group">
              <label class="input-label" for="project-name">Project Name</label>
              <input type="text" class="input-field" id="project-name" placeholder="e.g. My Awesome API" maxlength="60" required>
            </div>
            <div class="input-group">
              <label class="input-label" for="project-slug">URL Slug</label>
              <input type="text" class="input-field" id="project-slug" placeholder="my-awesome-api" maxlength="50" style="font-family:var(--font-mono);font-size:0.875rem;">
              <span style="font-size:0.75rem;color:var(--text-quaternary);">pulsepages.com/status/<span id="slug-preview">your-slug</span></span>
            </div>
            <div class="input-group">
              <label class="input-label" for="project-description">Description</label>
              <textarea class="input-field" id="project-description" placeholder="Brief description of your service" rows="3" maxlength="200"></textarea>
            </div>
            <div style="display:flex;gap:var(--space-12);justify-content:flex-end;margin-top:var(--space-8);">
              <button type="button" class="btn btn-ghost" id="new-project-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary" id="new-project-submit">Create Project</button>
            </div>
            <div id="new-project-error" style="display:none;color:var(--status-red);font-size:0.8125rem;text-align:center;"></div>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderEditProjectView(project) {
  const statuses = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">${escapeHTML(project.name)}</h1>
        <p class="page-description" style="font-family:var(--font-mono);font-size:0.8125rem;">/${escapeHTML(project.slug)}</p>
      </div>
      <div style="display:flex;gap:var(--space-12);">
        <a href="#/status/${escapeHTML(project.slug)}" class="btn btn-ghost" id="project-view-public" target="_blank">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          View Page
        </a>
        <button class="btn btn-danger btn-sm" id="project-delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Delete
        </button>
      </div>
    </div>

    <div class="editor-layout">
      <div class="editor-section">
        <div class="editor-section-header">
          <h2 class="editor-section-title">Components</h2>
          <button class="btn btn-subtle btn-sm" id="add-component-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Add Component
          </button>
        </div>
        <div class="editor-section-body">
          <div class="component-list" id="component-list">
            ${renderComponentItems(project, statuses)}
          </div>
          ${project.components.length === 0 ? '<div class="empty-state" style="padding:var(--space-32);" id="components-empty"><p class="empty-state-description">No components yet. Add your first service component.</p></div>' : ''}
        </div>
      </div>

      <div class="editor-section">
        <div class="editor-section-header">
          <h2 class="editor-section-title">Incidents</h2>
          <button class="btn btn-subtle btn-sm" id="create-incident-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Report Incident
          </button>
        </div>
        <div class="editor-section-body">
          <div id="project-incidents-list"></div>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="add-component-modal">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Add Component</h3>
          <button class="btn btn-icon" style="width:28px;height:28px;" id="close-component-modal" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="input-group">
            <label class="input-label" for="new-component-name">Component Name</label>
            <input type="text" class="input-field" id="new-component-name" placeholder="e.g. API Gateway" maxlength="50">
          </div>
          <div id="component-modal-error" style="display:none;color:var(--status-red);font-size:0.8125rem;margin-top:var(--space-8);"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="cancel-component">Cancel</button>
          <button class="btn btn-primary" id="save-component">Add Component</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="create-incident-modal">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Report Incident</h3>
          <button class="btn btn-icon" style="width:28px;height:28px;" id="close-incident-modal" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body">
          <form id="incident-form" style="display:flex;flex-direction:column;gap:var(--space-16);">
            <div class="input-group">
              <label class="input-label" for="incident-title">Title</label>
              <input type="text" class="input-field" id="incident-title" placeholder="Brief description of the issue" maxlength="100" required>
            </div>
            <div class="input-group">
              <label class="input-label" for="incident-description">Description</label>
              <textarea class="input-field" id="incident-description" placeholder="More details about the incident" rows="3" maxlength="500"></textarea>
            </div>
            <div class="input-group">
              <label class="input-label" for="incident-severity">Severity</label>
              <select class="input-field" id="incident-severity">
                <option value="info">Maintenance</option>
                <option value="warning" selected>Degraded Performance</option>
                <option value="danger">Major Outage</option>
              </select>
            </div>
            <div class="input-group">
              <label class="input-label">Affected Components</label>
              <div id="incident-components-checkboxes" style="display:flex;flex-direction:column;gap:var(--space-8);margin-top:var(--space-4);">
                ${project.components.map(comp => `
                  <label style="display:flex;align-items:center;gap:var(--space-8);cursor:pointer;font-size:0.875rem;color:var(--text-secondary);">
                    <input type="checkbox" value="${escapeHTML(comp.id)}" name="incident-comp" style="accent-color:var(--accent-violet);width:16px;height:16px;cursor:pointer;">
                    <span class="status-dot ${getStatusDotClass(comp.status)}" style="width:6px;height:6px;"></span>
                    ${escapeHTML(comp.name)}
                  </label>
                `).join('')}
                ${project.components.length === 0 ? '<span style="font-size:0.8125rem;color:var(--text-quaternary);font-style:italic;">No components available</span>' : ''}
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="cancel-incident">Cancel</button>
          <button class="btn btn-primary" id="save-incident">Report Incident</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="delete-project-modal">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Delete Project</h3>
          <button class="btn btn-icon" style="width:28px;height:28px;" id="close-delete-modal" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body">
          <p style="color:var(--text-secondary);font-size:0.9375rem;">
            Are you sure you want to delete <strong style="color:var(--text-primary);">${escapeHTML(project.name)}</strong>? This action cannot be undone. All components and incident history will be permanently deleted.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="cancel-delete">Cancel</button>
          <button class="btn btn-danger" id="confirm-delete">Delete Project</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="update-incident-modal">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Add Update</h3>
          <button class="btn btn-icon" style="width:28px;height:28px;" id="close-update-modal" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="update-incident-id">
          <div class="input-group">
            <label class="input-label" for="update-incident-message">Message</label>
            <textarea class="input-field" id="update-incident-message" placeholder="What's the latest status?" rows="3" maxlength="500"></textarea>
          </div>
          <div class="input-group">
            <label class="input-label" for="update-incident-status">Status</label>
            <select class="input-field" id="update-incident-status">
              <option value="investigating">Investigating</option>
              <option value="identified">Identified</option>
              <option value="monitoring">Monitoring</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="cancel-update">Cancel</button>
          <button class="btn btn-primary" id="save-update">Add Update</button>
        </div>
      </div>
    </div>
  `;
}

function renderComponentItems(project, statuses) {
  return project.components.map(comp => `
    <div class="component-item" data-component-id="${escapeHTML(comp.id)}">
      <div class="component-item-info">
        <span class="status-dot ${getStatusDotClass(comp.status)}"></span>
        <span class="component-item-name">${escapeHTML(comp.name)}</span>
      </div>
      <div class="component-item-actions">
        <select class="component-status-select" data-comp-id="${escapeHTML(comp.id)}">
          ${statuses.map(s => `
            <option value="${s}" ${comp.status === s ? 'selected' : ''}>${getStatusLabel(s)}</option>
          `).join('')}
        </select>
        <button class="btn btn-icon" style="width:28px;height:28px;" data-delete-comp="${escapeHTML(comp.id)}" aria-label="Delete component">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function renderIncidentItem(inc, project) {
  const compNames = (inc.component_ids || inc.components || [])
    .map(cid => {
      const comp = project.components.find(c => c.id === cid);
      return comp ? escapeHTML(comp.name) : null;
    })
    .filter(Boolean);

  return `
    <div class="incident-item" data-incident-id="${escapeHTML(inc.id)}">
      <div class="incident-dot incident-dot-${escapeHTML(inc.status === 'resolved' ? 'resolved' : inc.severity === 'danger' ? 'danger' : inc.severity === 'warning' ? 'warning' : 'info')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${inc.status === 'resolved'
            ? '<polyline points="20 6 9 17 4 12"></polyline>'
            : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'}
        </svg>
      </div>
      <div class="incident-content">
        <div style="display:flex;align-items:center;gap:var(--space-8);flex-wrap:wrap;margin-bottom:var(--space-4);">
          <span class="incident-title">${escapeHTML(inc.title)}</span>
          <span class="badge badge-${escapeHTML(inc.status === 'resolved' ? 'success' : inc.severity === 'danger' ? 'danger' : inc.severity === 'warning' ? 'warning' : 'info')} incident-status-badge">${escapeHTML(inc.status)}</span>
          ${compNames.map(n => `<span class="badge badge-neutral">${n}</span>`).join('')}
        </div>
        <div class="incident-meta">${new Date(inc.createdAt || inc.created_at).toLocaleString()}</div>
        ${inc.description ? `<p class="incident-description">${escapeHTML(inc.description)}</p>` : ''}
        ${(inc.incident_updates || inc.updates || []).map(u => `
          <div style="margin-top:var(--space-8);padding-left:var(--space-12);border-left:2px solid var(--border-secondary);">
            <p style="font-size:0.8125rem;color:var(--text-tertiary);">${escapeHTML(u.message)}</p>
            <span style="font-size:0.75rem;color:var(--text-quaternary);">${new Date(u.createdAt || u.created_at).toLocaleString()} — ${escapeHTML(u.status)}</span>
          </div>
        `).join('')}
        ${inc.status !== 'resolved' ? `
          <div style="margin-top:var(--space-12);display:flex;gap:var(--space-8);" class="incident-actions">
            <button class="btn btn-subtle btn-sm" data-update-incident="${escapeHTML(inc.id)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              Add Update
            </button>
            <button class="btn btn-subtle btn-sm" data-resolve-incident="${escapeHTML(inc.id)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Resolve
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

export function initProjectEditor(params) {
  const isNew = params.id === 'new';

  if (isNew) {
    initNewProjectForm();
  } else {
    initEditProject(params.id);
  }
}

function initNewProjectForm() {
  const form = document.getElementById('new-project-form');
  const nameInput = document.getElementById('project-name');
  const slugInput = document.getElementById('project-slug');
  const slugPreview = document.getElementById('slug-preview');
  const cancelBtn = document.getElementById('new-project-cancel');
  const errorDiv = document.getElementById('new-project-error');

  if (nameInput && slugInput) {
    nameInput.addEventListener('input', () => {
      const slug = slugify(nameInput.value);
      slugInput.value = slug;
      if (slugPreview) slugPreview.textContent = slug || 'your-slug';
    });

    slugInput.addEventListener('input', () => {
      if (slugPreview) slugPreview.textContent = slugInput.value || 'your-slug';
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => router.navigate('/dashboard'));
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = sanitizeInput(nameInput.value);
      let slug = slugInput.value.toLowerCase().trim();
      const description = sanitizeInput(document.getElementById('project-description').value);

      if (!name || name.length < 2) {
        showError(errorDiv, 'Project name must be at least 2 characters.');
        return;
      }

      if (!validateSlug(slug)) {
        showError(errorDiv, 'Slug must be lowercase letters, numbers, and hyphens only (2-50 chars).');
        return;
      }

      const user = auth.getCurrentUser();
      
      const userProjects = store.getProjects(user.id);
      if (userProjects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        showError(errorDiv, 'You already have a project with this name.');
        return;
      }

      let existing = store.getProjectBySlug(slug);
      if (existing) {
        slug = slug + '-' + Math.floor(1000 + Math.random() * 9000);
      }

      const check = canCreateProject(user.id);
      if (!check.allowed) {
        showError(errorDiv, check.message);
        return;
      }

      const projectData = {
        userId: user.id,
        name,
        slug,
        description
      };
      
      const submitBtn = document.getElementById('new-project-submit');
      if (submitBtn) {
          submitBtn.innerText = 'Creating...';
          submitBtn.disabled = true;
      }

      const result = await store.addProject(projectData);
      
      if (result.success) {
        router.navigate(`/project/${result.project.id}`);
      } else {
        showError(errorDiv, result.error);
        if (submitBtn) {
            submitBtn.innerText = 'Create Project';
            submitBtn.disabled = false;
        }
      }
    });
  }
}

function initEditProject(projectId) {
  const project = store.getProjectById(projectId);
  if (!project) return;

  loadProjectIncidents(projectId, project);

  bindComponentStatusListeners(projectId);
  bindComponentDeleteListeners(projectId);

  setupModal('add-component-modal', 'add-component-btn', 'close-component-modal', 'cancel-component');
  setupModal('create-incident-modal', 'create-incident-btn', 'close-incident-modal', 'cancel-incident');
  setupModal('delete-project-modal', 'project-delete', 'close-delete-modal', 'cancel-delete');
  setupModal('update-incident-modal', null, 'close-update-modal', 'cancel-update');

  const createIncidentBtn = document.getElementById('create-incident-btn');
  if (createIncidentBtn) {
    createIncidentBtn.addEventListener('click', () => {
      const freshProject = store.getProjectById(projectId);
      const container = document.getElementById('incident-components-checkboxes');
      if (container && freshProject) {
        container.innerHTML = freshProject.components.map(comp => `
          <label style="display:flex;align-items:center;gap:var(--space-8);cursor:pointer;font-size:0.875rem;color:var(--text-secondary);">
            <input type="checkbox" value="${escapeHTML(comp.id)}" name="incident-comp" style="accent-color:var(--accent-violet);width:16px;height:16px;cursor:pointer;">
            <span class="status-dot ${getStatusDotClass(comp.status)}" style="width:6px;height:6px;"></span>
            ${escapeHTML(comp.name)}
          </label>
        `).join('') + (freshProject.components.length === 0 ? '<span style="font-size:0.8125rem;color:var(--text-quaternary);font-style:italic;">No components available</span>' : '');
      }
    });
  }

  const saveComp = document.getElementById('save-component');
  if (saveComp) {
    saveComp.addEventListener('click', async () => {
      const nameInput = document.getElementById('new-component-name');
      const errorDiv = document.getElementById('component-modal-error');
      const name = sanitizeInput(nameInput.value);
      if (!name || name.length < 1) return;

      const check = canAddComponent(projectId);
      if (!check.allowed) {
        showError(errorDiv, check.message);
        return;
      }

      saveComp.innerText = 'Saving...';
      saveComp.disabled = true;

      const result = await store.addComponent(projectId, name);
      
      saveComp.innerText = 'Add Component';
      saveComp.disabled = false;

      if (result.success) {
        appendComponentToDOM(result.component, projectId);
        const modal = document.getElementById('add-component-modal');
        if (modal) modal.classList.remove('active');
        nameInput.value = '';
        if (errorDiv) errorDiv.style.display = 'none';
      } else {
        showError(errorDiv, result.error);
      }
    });
  }

  const saveIncident = document.getElementById('save-incident');
  if (saveIncident) {
    saveIncident.addEventListener('click', async () => {
      const title = sanitizeInput(document.getElementById('incident-title').value);
      const description = sanitizeInput(document.getElementById('incident-description').value);
      const severity = document.getElementById('incident-severity').value;

      if (!title || title.length < 2) return;

      const selectedComps = [];
      document.querySelectorAll('#incident-components-checkboxes input[name="incident-comp"]:checked').forEach(cb => {
        selectedComps.push(cb.value);
      });

      const incidentData = {
        projectId,
        title,
        description,
        status: 'investigating',
        severity,
        components: selectedComps
      };

      saveIncident.innerText = 'Saving...';
      saveIncident.disabled = true;

      const result = await store.addIncident(incidentData);

      saveIncident.innerText = 'Report Incident';
      saveIncident.disabled = false;

      if (result.success) {
        const severityToStatus = { danger: 'major_outage', warning: 'degraded', info: 'maintenance' };
        const newStatus = severityToStatus[severity] || 'degraded';
        
        for (const cid of selectedComps) {
           await store.updateComponentStatus(cid, projectId, newStatus);
        }
        
        const latestProject = store.getProjectById(projectId);
        appendIncidentToDOM(result.incident, latestProject);
        syncComponentListDOM(latestProject);

        const modal = document.getElementById('create-incident-modal');
        if (modal) modal.classList.remove('active');
        document.getElementById('incident-title').value = '';
        document.getElementById('incident-description').value = '';
        document.getElementById('incident-severity').value = 'warning';
        document.querySelectorAll('#incident-components-checkboxes input[name="incident-comp"]').forEach(cb => {
          cb.checked = false;
        });
      } else {
        alert('Error parsing incident: ' + result.error);
      }
    });
  }

  const saveUpdate = document.getElementById('save-update');
  if (saveUpdate) {
    saveUpdate.addEventListener('click', async () => {
      const incId = document.getElementById('update-incident-id').value;
      const message = sanitizeInput(document.getElementById('update-incident-message').value);
      const status = document.getElementById('update-incident-status').value;
      
      if (!message || !incId) return;
      
      const incident = store.getIncidentById(incId);
      if (incident) {
        saveUpdate.innerText = 'Saving...';
        saveUpdate.disabled = true;

        const result = await store.updateIncident(incId, { status }, message);
        
        saveUpdate.innerText = 'Add Update';
        saveUpdate.disabled = false;

        if (result.success) {
          let targetProject = store.getProjectById(projectId);
          loadProjectIncidents(projectId, targetProject);
          const modal = document.getElementById('update-incident-modal');
          if (modal) modal.classList.remove('active');
        } else {
          alert('Error saving update: ' + result.error);
        }
      }
    });
  }

  const confirmDelete = document.getElementById('confirm-delete');
  if (confirmDelete) {
    confirmDelete.addEventListener('click', async () => {
      confirmDelete.innerText = 'Deleting...';
      confirmDelete.disabled = true;
      await store.deleteProject(projectId);
      router.navigate('/dashboard');
    });
  }
}

function appendComponentToDOM(comp, projectId) {
  const list = document.getElementById('component-list');
  const emptyState = document.getElementById('components-empty');
  if (emptyState) emptyState.remove();

  const statuses = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];

  const div = document.createElement('div');
  div.className = 'component-item';
  div.dataset.componentId = comp.id;
  div.style.animation = 'component-in 0.3s ease forwards';
  div.innerHTML = `
    <div class="component-item-info">
      <span class="status-dot ${getStatusDotClass(comp.status)}"></span>
      <span class="component-item-name">${escapeHTML(comp.name)}</span>
    </div>
    <div class="component-item-actions">
      <select class="component-status-select" data-comp-id="${escapeHTML(comp.id)}">
        ${statuses.map(s => `
          <option value="${s}" ${comp.status === s ? 'selected' : ''}>${getStatusLabel(s)}</option>
        `).join('')}
      </select>
      <button class="btn btn-icon" style="width:28px;height:28px;" data-delete-comp="${escapeHTML(comp.id)}" aria-label="Delete component">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `;

  list.appendChild(div);

  const select = div.querySelector('.component-status-select');
  if (select) {
    select.addEventListener('change', () => {
      handleStatusChange(select, projectId);
    });
  }

  const deleteBtn = div.querySelector('[data-delete-comp]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleComponentDelete(deleteBtn, projectId);
    });
  }
}

function appendIncidentToDOM(incident, project) {
  const container = document.getElementById('project-incidents-list');
  if (!container) return;

  let timeline = container.querySelector('.incident-timeline');
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  if (!timeline) {
    timeline = document.createElement('div');
    timeline.className = 'incident-timeline';
    container.appendChild(timeline);
  }

  const div = document.createElement('div');
  div.style.animation = 'component-in 0.3s ease forwards';
  div.innerHTML = renderIncidentItem(incident, project);

  const incidentEl = div.firstElementChild;
  timeline.insertBefore(incidentEl, timeline.firstChild);

  bindResolveListener(incidentEl, project.id, project);
  bindUpdateListener(incidentEl);
}

function syncComponentListDOM(project) {
  const statuses = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];
  const list = document.getElementById('component-list');
  if (!list) return;
  
  list.innerHTML = renderComponentItems(project, statuses);
  bindComponentStatusListeners(project.id);
  bindComponentDeleteListeners(project.id);
}

function handleStatusChange(select, projectId) {
  const compId = select.dataset.compId;
  const newStatus = select.value;
  store.updateComponentStatus(compId, projectId, newStatus);

  const item = select.closest('.component-item');
  const dot = item.querySelector('.status-dot');
  if (dot) {
    dot.className = 'status-dot ' + getStatusDotClass(newStatus);
  }
}

function handleComponentDelete(btn, projectId) {
  const compId = btn.dataset.deleteComp;
  store.deleteComponent(compId, projectId);

  const item = btn.closest('.component-item');
  item.style.transition = 'opacity 0.25s, transform 0.25s';
  item.style.opacity = '0';
  item.style.transform = 'translateX(10px)';
  setTimeout(() => {
    item.remove();
    const list = document.getElementById('component-list');
    if (list && list.children.length === 0) {
      const body = list.parentElement;
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.id = 'components-empty';
      empty.style.padding = 'var(--space-32)';
      empty.innerHTML = '<p class="empty-state-description">No components yet. Add your first service component.</p>';
      body.appendChild(empty);
    }
  }, 250);
}

function bindComponentStatusListeners(projectId) {
  document.querySelectorAll('.component-status-select').forEach(select => {
    select.addEventListener('change', () => handleStatusChange(select, projectId));
  });
}

function bindComponentDeleteListeners(projectId) {
  document.querySelectorAll('[data-delete-comp]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleComponentDelete(btn, projectId);
    });
  });
}

function bindUpdateListener(container) {
  const elements = container ? [container] : document.querySelectorAll('.incident-item');
  elements.forEach(incEl => {
    incEl.querySelectorAll('[data-update-incident]').forEach(btn => {
      btn.addEventListener('click', () => {
        const incId = btn.dataset.updateIncident;
        document.getElementById('update-incident-id').value = incId;
        document.getElementById('update-incident-message').value = '';
        document.getElementById('update-incident-status').value = 'investigating';
        const modal = document.getElementById('update-incident-modal');
        if (modal) modal.classList.add('active');
      });
    });
  });
}

function bindResolveListener(el, projectId, project) {
  el.querySelectorAll('[data-resolve-incident]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.innerText = '...';
      btn.disabled = true;
      const incId = btn.dataset.resolveIncident;
      const incident = store.getIncidentById(incId);
      if (incident) {
        const result = await store.updateIncident(incId, { status: 'resolved' }, 'This incident has been resolved.');
        
        if (!result.success) {
          btn.innerText = 'Resolve';
          btn.disabled = false;
          alert('Error resolving incident: ' + result.error);
          return;
        }

        for (const cid of (incident.component_ids || incident.components || [])) {
           await store.updateComponentStatus(cid, projectId, 'operational');
        }

        const incEl = btn.closest('.incident-item');
        const badge = incEl.querySelector('.incident-status-badge');
        if (badge) {
          badge.textContent = 'resolved';
          badge.className = 'badge badge-success incident-status-badge';
        }

        const dot = incEl.querySelector('.incident-dot');
        if (dot) {
          dot.className = 'incident-dot incident-dot-resolved';
          dot.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        }
        
        const actionsPane = incEl.querySelector('.incident-actions');
        if (actionsPane) {
          actionsPane.remove();
        }

        syncComponentListDOM(store.getProjectById(projectId));
      }
    });
  });
}

function loadProjectIncidents(projectId, project) {
  const container = document.getElementById('project-incidents-list');
  if (!container) return;

  const incidents = store.getIncidents(projectId);

  if (incidents.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-24);">
        <p class="empty-state-description" style="font-size:0.875rem;">No incidents reported. Great job!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="incident-timeline">
      ${incidents.slice(0, 10).map(inc => renderIncidentItem(inc, project)).join('')}
    </div>
  `;

  incidents.slice(0, 10).forEach(inc => {
    const el = container.querySelector(`[data-incident-id="${inc.id}"]`);
    if (el) {
      bindResolveListener(el, projectId, project);
      bindUpdateListener(el);
    }
  });
}

function setupModal(modalId, openId, closeId, cancelId) {
  const modal = document.getElementById(modalId);
  const openBtn = document.getElementById(openId);
  const closeBtn = document.getElementById(closeId);
  const cancelBtn = document.getElementById(cancelId);

  if (!modal) return;

  const open = () => modal.classList.add('active');
  const close = () => modal.classList.remove('active');

  if (openBtn) openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
