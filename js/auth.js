import { supabase } from './supabase.js';
import { validateEmail, sanitizeInput } from './utils/security.js';

class Auth {
  constructor() {
    this._currentUser = null;
    this._profile = null;
    this._onAuthStateChangeCallbacks = [];
  }

  async init() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
      this._currentUser = session.user;
      await this._fetchProfile();
    }

    // Mantener la sesión sincronizada
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        this._currentUser = session.user;
        await this._fetchProfile();
      } else if (event === 'SIGNED_OUT') {
        this._currentUser = null;
        this._profile = null;
      }
      this._notifySubscribers();
    });
  }

  async _fetchProfile() {
    if (!this._currentUser) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', this._currentUser.id)
      .single();
      
    if (!error && data) {
      this._profile = data;
    } else {
      // Fallback si por algún motivo el trigger no ha creado el perfil a tiempo
      this._profile = { name: this._currentUser.user_metadata?.name || 'User', plan: 'free' };
    }
  }

  subscribe(callback) {
    this._onAuthStateChangeCallbacks.push(callback);
  }

  _notifySubscribers() {
    this._onAuthStateChangeCallbacks.forEach(cb => cb());
  }

  isAuthenticated() {
    return !!this._currentUser;
  }

  getCurrentUser() {
    if (!this.isAuthenticated()) return null;
    // Combinar los metadatos visuales del perfil para mantener compatibilidad con el resto del código
    return {
      id: this._currentUser.id,
      email: this._currentUser.email,
      name: this._profile?.name || '',
      plan: this._profile?.plan || 'free'
    };
  }

  async login(email, password) {
    email = sanitizeInput(email);
    if (!email || !password) return { success: false, error: 'Email and password are required.' };
    if (!validateEmail(email)) return { success: false, error: 'Invalid email format.' };

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return { success: false, error: 'Incorrect email or password.' };
      }
      return { success: false, error: error.message };
    }
    
    this._currentUser = data.user;
    await this._fetchProfile();
    return { success: true };
  }

  async register(name, email, password) {
    name = sanitizeInput(name);
    email = sanitizeInput(email);

    if (!name || !email || !password) return { success: false, error: 'All fields are required.' };
    if (name.length < 2 || name.length > 50) return { success: false, error: 'Name must be 2-50 characters.' };
    if (!validateEmail(email)) return { success: false, error: 'Invalid email format.' };
    if (password.length < 8) return { success: false, error: 'Password must be at least 8 characters long.' };

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name } // Para que el Trigger lo use al crear el Profile
      }
    });

    if (error) return { success: false, error: error.message };
    
    this._currentUser = data.user;
    await this._fetchProfile();
    return { success: true };
  }

  async logout() {
    await supabase.auth.signOut();
  }

  async updateProfile(updates) {
    if (!this.isAuthenticated()) return { success: false, error: 'Not authenticated.' };

    const sanitized = {};
    if (updates.name) {
      sanitized.name = sanitizeInput(updates.name);
      if (sanitized.name.length < 2 || sanitized.name.length > 50) return { success: false, error: 'Name must be 2-50 characters.' };
    }

    if (sanitized.name) {
      const { error } = await supabase
        .from('profiles')
        .update({ name: sanitized.name })
        .eq('id', this._currentUser.id);
        
      if (error) return { success: false, error: error.message };
    }

    if (updates.email) {
      const newEmail = sanitizeInput(updates.email);
      if (!validateEmail(newEmail)) return { success: false, error: 'Invalid email format.' };
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) return { success: false, error: error.message };
    }

    await this._fetchProfile();
    return { success: true };
  }

  async changePlan(plan) {
    if (!this.isAuthenticated()) return { success: false, error: 'Not authenticated.' };
    const validPlans = ['free', 'pro', 'business'];
    if (!validPlans.includes(plan)) return { success: false, error: 'Invalid plan.' };

    const { error } = await supabase
      .from('profiles')
      .update({ plan })
      .eq('id', this._currentUser.id);

    if (error) return { success: false, error: error.message };

    await this._fetchProfile();
    return { success: true };
  }
}

export const auth = new Auth();
