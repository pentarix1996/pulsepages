import { supabase } from './supabase.js';

const STORAGE_KEYS = {
  PROJECTS: 'pp_projects',
  INCIDENTS: 'pp_incidents'
};

class Store {
  constructor() {
    this._listeners = {};
    // La carga inicial limpia ahora dependerá de auth.js cuando detecte sesión
  }

  // Se llama después de auth.init() si el usuario está logueado
  async loadFromSupabase(userId) {
    if (!userId) return;

    const { data: projects, error: pError } = await supabase
      .from('projects')
      .select('*, components(*)');
      
    if (!pError && projects) {
      this._set(STORAGE_KEYS.PROJECTS, projects);
    }

    const { data: incidents, error: iError } = await supabase
      .from('incidents')
      .select('*, incident_updates(*)');
      
    if (!iError && incidents) {
      this._set(STORAGE_KEYS.INCIDENTS, incidents);
    }
  }

  _get(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  _set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      this._emit(key, value);
    } catch (e) {
      console.error('Store: Failed to save', key, e);
    }
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  _emit(event, data) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(cb => cb(data));
  }

  // PROYECTOS (Lectura Síncrona)
  getProjects(userId) {
    const projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    return userId ? projects.filter(p => p.user_id === userId) : projects;
  }

  getProjectById(id) {
    const projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    return projects.find(p => p.id === id);
  }

  getProjectBySlug(slug) {
    const projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    return projects.find(p => p.slug === slug);
  }

  // PROYECTOS (Escritura Asíncrona a Supabase)
  async addProject(projectData) {
    const { data, error } = await supabase.from('projects').insert([{
      name: projectData.name,
      slug: projectData.slug,
      description: projectData.description,
      user_id: projectData.userId
    }]).select().single();

    if (error) return { success: false, error: error.message };

    const newProject = { ...data, components: [] };
    
    const projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    projects.push(newProject);
    this._set(STORAGE_KEYS.PROJECTS, projects);

    return { success: true, project: newProject };
  }

  async updateProject(projectId, updates) {
    const { error } = await supabase.from('projects').update(updates).eq('id', projectId);
    if (error) return { success: false, error: error.message };

    const projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    const idx = projects.findIndex(p => p.id === projectId);
    if (idx !== -1) {
      projects[idx] = { ...projects[idx], ...updates, updated_at: new Date().toISOString() };
      this._set(STORAGE_KEYS.PROJECTS, projects);
    }
    return { success: true };
  }

  async deleteProject(projectId) {
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    if (error) return { success: false, error: error.message };

    let projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    projects = projects.filter(p => p.id !== projectId);
    this._set(STORAGE_KEYS.PROJECTS, projects);

    let incidents = this._get(STORAGE_KEYS.INCIDENTS) || [];
    incidents = incidents.filter(i => i.project_id !== projectId);
    this._set(STORAGE_KEYS.INCIDENTS, incidents);

    return { success: true };
  }

  // COMPONENTES (Add/Update)
  async addComponent(projectId, componentName) {
    const { data, error } = await supabase.from('components').insert([{
      project_id: projectId,
      name: componentName,
      status: 'operational'
    }]).select().single();

    if (error) return { success: false, error: error.message };

    const projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    const pIdx = projects.findIndex(p => p.id === projectId);
    if (pIdx !== -1) {
      projects[pIdx].components = projects[pIdx].components || [];
      projects[pIdx].components.push(data);
      this._set(STORAGE_KEYS.PROJECTS, projects);
    }
    return { success: true, component: data };
  }

  async updateComponentStatus(componentId, projectId, status) {
    const { error } = await supabase.from('components').update({ status }).eq('id', componentId);
    if (error) return { success: false, error: error.message };

    const projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    const pIdx = projects.findIndex(p => p.id === projectId);
    if (pIdx !== -1) {
      const cIdx = projects[pIdx].components.findIndex(c => c.id === componentId);
      if (cIdx !== -1) {
        projects[pIdx].components[cIdx].status = status;
        this._set(STORAGE_KEYS.PROJECTS, projects);
      }
    }
    return { success: true };
  }

  async deleteComponent(componentId, projectId) {
    const { error } = await supabase.from('components').delete().eq('id', componentId);
    if (error) return { success: false, error: error.message };

    const projects = this._get(STORAGE_KEYS.PROJECTS) || [];
    const pIdx = projects.findIndex(p => p.id === projectId);
    if (pIdx !== -1) {
      projects[pIdx].components = projects[pIdx].components.filter(c => c.id !== componentId);
      this._set(STORAGE_KEYS.PROJECTS, projects);
    }
    return { success: true };
  }

  // INCIDENTES (Lectura Síncrona)
  getIncidents(projectId) {
    const incidents = this._get(STORAGE_KEYS.INCIDENTS) || [];
    return projectId ? incidents.filter(i => i.project_id === projectId) : incidents;
  }

  getIncidentById(id) {
    const incidents = this._get(STORAGE_KEYS.INCIDENTS) || [];
    return incidents.find(i => i.id === id);
  }

  // INCIDENTES (Escritura Asíncrona)
  async addIncident(incidentData) {
    const { data: incData, error: incError } = await supabase.from('incidents').insert([{
      project_id: incidentData.projectId,
      title: incidentData.title,
      description: incidentData.description,
      status: incidentData.status,
      severity: incidentData.severity,
      component_ids: incidentData.components
    }]).select().single();

    if (incError) return { success: false, error: incError.message };

    // Añadir el primer update si proporcionaron mensaje (suele ser description)
    const { data: updateData } = await supabase.from('incident_updates').insert([{
      incident_id: incData.id,
      message: incData.description || 'Incident reported.',
      status: incData.status
    }]).select().single();

    const newIncident = { ...incData, incident_updates: updateData ? [updateData] : [] };

    const incidents = this._get(STORAGE_KEYS.INCIDENTS) || [];
    incidents.unshift(newIncident);
    this._set(STORAGE_KEYS.INCIDENTS, incidents);

    return { success: true, incident: newIncident };
  }

  async updateIncident(incidentId, updates, newUpdateMessage) {
    const { error } = await supabase.from('incidents').update(updates).eq('id', incidentId);
    if (error) return { success: false, error: error.message };

    let newHistoryItem = null;
    if (newUpdateMessage && updates.status) {
      const { data: upData } = await supabase.from('incident_updates').insert([{
        incident_id: incidentId,
        message: newUpdateMessage,
        status: updates.status
      }]).select().single();
      newHistoryItem = upData;
    }

    const incidents = this._get(STORAGE_KEYS.INCIDENTS) || [];
    const idx = incidents.findIndex(i => i.id === incidentId);
    if (idx !== -1) {
      incidents[idx] = { ...incidents[idx], ...updates };
      if (newHistoryItem) {
        incidents[idx].incident_updates = incidents[idx].incident_updates || [];
        incidents[idx].incident_updates.unshift(newHistoryItem);
      }
      this._set(STORAGE_KEYS.INCIDENTS, incidents);
    }
    return { success: true };
  }

  async deleteIncident(incidentId) {
    const { error } = await supabase.from('incidents').delete().eq('id', incidentId);
    if (error) return { success: false, error: error.message };

    let incidents = this._get(STORAGE_KEYS.INCIDENTS) || [];
    incidents = incidents.filter(i => i.id !== incidentId);
    this._set(STORAGE_KEYS.INCIDENTS, incidents);
    return { success: true };
  }

  async resetUserData(userId) {
    // Esto dependerá ahora del dashboard y supabase, una llamada a delete proj es mejor, o ejecutar Edge Function
    // Lo simplificaremos eliminando proyecto por proyecto para disparar los webhooks local
    const projects = this.getProjects(userId);
    for (const p of projects) {
        await this.deleteProject(p.id);
    }
    return { success: true };
  }

  clearLocalData() {
    localStorage.removeItem(STORAGE_KEYS.PROJECTS);
    localStorage.removeItem(STORAGE_KEYS.INCIDENTS);
    this._emit(STORAGE_KEYS.PROJECTS, null);
  }
}

export const store = new Store();
export { STORAGE_KEYS };
