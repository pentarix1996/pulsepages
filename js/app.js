import { router } from './router.js';
import { auth } from './auth.js';
import { escapeHTML } from './utils/security.js';

import { renderNavbar, initNavbar } from './components/navbar.js';
import { renderHero } from './components/hero.js';
import { renderFeatures } from './components/features.js';
import { renderPricing, initPricing } from './components/pricing.js';
import { renderFaq, initFaq } from './components/faq.js';
import { renderFooter } from './components/footer.js';
import { renderDashboard, initDashboard } from './components/dashboard.js';
import { renderProjectEditor, initProjectEditor } from './components/project-editor.js';
import { renderStatusPage } from './components/status-page.js';
import { renderIncidents, initIncidents } from './components/incidents.js';
import { renderSettings, initSettings } from './components/settings.js';

const app = document.getElementById('app');

const protectedRoutes = ['/dashboard', '/project/', '/incidents', '/settings'];

router.beforeEach((path) => {
  const isProtected = protectedRoutes.some(r => path.startsWith(r));
  if (isProtected && !auth.isAuthenticated()) {
    router.navigate('/login');
    return false;
  }

  if ((path === '/login' || path === '/register') && auth.isAuthenticated()) {
    router.navigate('/dashboard');
    return false;
  }

  return true;
});

router.register('/', () => renderLanding());
router.register('/login', () => renderAuth('login'));
router.register('/register', () => renderAuth('register'));
router.register('/dashboard', () => renderApp(renderDashboard, initDashboard, 'Projects'));
router.register('/project/:id', (params) => renderApp(() => renderProjectEditor(params), () => initProjectEditor(params), 'Project'));
router.register('/incidents', () => renderApp(renderIncidents, initIncidents, 'Incidents'));
router.register('/settings', () => renderApp(renderSettings, initSettings, 'Settings'));
router.register('/status/:slug', (params) => renderPublicStatus(params));

function renderLanding() {
  app.innerHTML = `
    ${renderNavbar()}
    <main>
      ${renderHero()}
      ${renderFeatures()}
      ${renderPricing()}
      ${renderFaq()}
    </main>
    ${renderFooter()}
  `;
  initNavbar();
  initPricing();
  initFaq();
  window.scrollTo(0, 0);
}

function renderAuth(type) {
  const isLogin = type === 'login';

  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo">
            <div class="landing-nav-logo-icon" style="width:32px;height:32px;">P</div>
          </div>
          <h1 class="auth-title">${isLogin ? 'Welcome back' : 'Create your account'}</h1>
          <p class="auth-subtitle">${isLogin ? 'Log in to manage your status pages.' : 'Start monitoring in under 30 seconds.'}</p>
        </div>
        <form class="auth-form" id="auth-form">
          ${!isLogin ? `
            <div class="input-group">
              <label class="input-label" for="auth-name">Full Name</label>
              <input type="text" class="input-field" id="auth-name" placeholder="Alex Morgan" maxlength="50" required autocomplete="name">
            </div>
          ` : ''}
          <div class="input-group">
            <label class="input-label" for="auth-email">Email</label>
            <input type="email" class="input-field" id="auth-email" placeholder="you@example.com" maxlength="100" required autocomplete="email">
          </div>
          <div class="input-group">
            <label class="input-label" for="auth-password">Password</label>
            <input type="password" class="input-field" id="auth-password" placeholder="${isLogin ? 'Enter your password' : 'Min 8 chars, 1 upper, 1 number'}" minlength="8" required autocomplete="${isLogin ? 'current-password' : 'new-password'}">
          </div>
          <div id="auth-error" style="display:none;color:var(--status-red);font-size:0.8125rem;text-align:center;padding:var(--space-8);background:rgba(239,68,68,0.08);border-radius:var(--radius-comfortable);"></div>
          <button type="submit" class="btn btn-primary btn-block btn-lg" id="auth-submit">
            ${isLogin ? 'Log in' : 'Create account'}
          </button>
        </form>
        <div class="auth-footer">
          ${isLogin
      ? 'Don\'t have an account? <a href="#/register">Sign up</a>'
      : 'Already have an account? <a href="#/login">Log in</a>'}
        </div>
      </div>
    </div>
  `;

  const form = document.getElementById('auth-form');
  const errorDiv = document.getElementById('auth-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('auth-submit');

    // UI state
    const originalText = submitBtn.innerText;
    submitBtn.innerText = 'Loading...';
    submitBtn.disabled = true;

    let result;

    if (isLogin) {
      result = await auth.login(email, password);
    } else {
      const name = document.getElementById('auth-name').value;
      result = await auth.register(name, email, password);
    }

    submitBtn.innerText = originalText;
    submitBtn.disabled = false;

    if (result.success) {
      router.navigate('/dashboard');
    } else {
      errorDiv.textContent = result.error;
      errorDiv.style.display = 'block';
      setTimeout(() => { errorDiv.style.display = 'none'; }, 4000);
    }
  });
}

function renderApp(contentFn, initFn, pageTitle) {
  const user = auth.getCurrentUser();
  if (!user) return;

  const currentPath = window.location.hash.slice(1);

  app.innerHTML = `
    <div class="app-layout">
      <div class="app-sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="app-sidebar" id="app-sidebar">
        <div class="app-sidebar-header">
          <a href="#/" class="app-sidebar-logo">
            <div class="app-sidebar-logo-icon">P</div>
            PulsePages
          </a>
        </div>
        <nav class="app-sidebar-nav">
          <div class="app-sidebar-section">
            <div class="app-sidebar-section-title">Menu</div>
            <a class="app-sidebar-link ${currentPath === '/dashboard' ? 'active' : ''}" href="#/dashboard" id="sidebar-dashboard">
              <svg class="app-sidebar-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
              Projects
            </a>
            <a class="app-sidebar-link ${currentPath === '/incidents' ? 'active' : ''}" href="#/incidents" id="sidebar-incidents">
              <svg class="app-sidebar-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              Incidents
            </a>
            <a class="app-sidebar-link ${currentPath === '/settings' ? 'active' : ''}" href="#/settings" id="sidebar-settings">
              <svg class="app-sidebar-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </a>
          </div>
        </nav>
        <div class="app-sidebar-footer">
          <div class="app-sidebar-user" id="sidebar-user">
            <div class="app-sidebar-avatar">${escapeHTML(user.name.charAt(0).toUpperCase())}</div>
            <div class="app-sidebar-user-info">
              <div class="app-sidebar-user-name">${escapeHTML(user.name)}</div>
              <div class="app-sidebar-user-plan">${escapeHTML((user.plan || 'free').charAt(0).toUpperCase() + (user.plan || 'free').slice(1))} Plan</div>
            </div>
          </div>
        </div>
      </aside>
      <div class="app-main">
        <header class="app-topbar">
          <button class="app-topbar-mobile" id="topbar-mobile-toggle" aria-label="Toggle sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
          <div class="app-topbar-title">${escapeHTML(pageTitle)}</div>
          <div class="app-topbar-actions">
            <a href="#/" class="btn btn-ghost btn-sm" id="topbar-home">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              Home
            </a>
          </div>
        </header>
        <div class="app-content" id="app-content">
          ${contentFn()}
        </div>
      </div>
    </div>
  `;

  const mobileToggle = document.getElementById('topbar-mobile-toggle');
  const sidebar = document.getElementById('app-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const sidebarUser = document.getElementById('sidebar-user');

  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('active');
    });
  }

  if (overlay && sidebar) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  if (sidebarUser) {
    sidebarUser.addEventListener('click', () => {
      router.navigate('/settings');
      if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
      }
    });
  }

  if (initFn) initFn();
}

async function renderPublicStatus(params) {
  app.innerHTML = `<div style="padding:100px;text-align:center;color:var(--text-secondary);font-family:var(--font-mono);">Loading status page...</div>`;
  app.innerHTML = await renderStatusPage(params);
  window.scrollTo(0, 0);
}

import { store } from './store.js';

// Esperamos a que Auth se inicialice con Supabase antes de arrancar el router
async function initApp() {
  await auth.init();
  const user = auth.getCurrentUser();
  if (user) {
    await store.loadFromSupabase(user.id);
  }

  // Suscribirse a cambios de auth para recargar datos o limpiar
  auth.subscribe(async () => {
    const u = auth.getCurrentUser();
    if (u) {
      await store.loadFromSupabase(u.id);
    } else {
      store.clearLocalData();
    }
  });

  router.start();
}

initApp();
