import { escapeHTML } from '../utils/security.js';
import { auth } from '../auth.js';
import { router } from '../router.js';

export function renderNavbar() {
  const isAuth = auth.isAuthenticated();

  return `
    <nav class="landing-nav" id="landing-nav">
      <div class="landing-nav-inner">
        <a href="#/" class="landing-nav-logo" id="nav-logo">
          <div class="landing-nav-logo-icon">P</div>
          PulsePages
        </a>
        <div class="landing-nav-links" id="nav-links">
          <a href="#features" class="landing-nav-link" data-nav="features">Features</a>
          <a href="#pricing" class="landing-nav-link" data-nav="pricing">Pricing</a>
          <a href="#faq" class="landing-nav-link" data-nav="faq">FAQ</a>
        </div>
        <div class="landing-nav-actions" id="nav-actions">
          ${isAuth ? `
            <a href="#/dashboard" class="btn btn-ghost btn-sm" id="nav-dashboard">Dashboard</a>
          ` : `
            <a href="#/login" class="btn btn-ghost btn-sm" id="nav-login">Log in</a>
            <a href="#/register" class="btn btn-primary btn-sm" id="nav-signup">Start free</a>
          `}
        </div>
        <button class="landing-nav-mobile" id="nav-mobile-toggle" aria-label="Toggle menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
      </div>
    </nav>
    <div class="mobile-menu" id="mobile-menu">
      <button class="btn btn-icon mobile-menu-close" id="mobile-menu-close" aria-label="Close menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <a href="#features" class="mobile-menu-link" data-mobile-nav="features">Features</a>
      <a href="#pricing" class="mobile-menu-link" data-mobile-nav="pricing">Pricing</a>
      <a href="#faq" class="mobile-menu-link" data-mobile-nav="faq">FAQ</a>
      ${isAuth ? `
        <a href="#/dashboard" class="btn btn-primary btn-lg">Dashboard</a>
      ` : `
        <a href="#/login" class="btn btn-ghost btn-lg">Log in</a>
        <a href="#/register" class="btn btn-primary btn-lg">Start free</a>
      `}
    </div>
  `;
}

export function initNavbar() {
  const toggle = document.getElementById('nav-mobile-toggle');
  const menu = document.getElementById('mobile-menu');
  const close = document.getElementById('mobile-menu-close');

  if (toggle && menu) {
    toggle.addEventListener('click', () => menu.classList.add('active'));
  }

  if (close && menu) {
    close.addEventListener('click', () => menu.classList.remove('active'));
  }

  if (menu) {
    menu.querySelectorAll('[data-mobile-nav]').forEach(link => {
      link.addEventListener('click', () => menu.classList.remove('active'));
    });
  }

  document.querySelectorAll('[data-nav]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.getAttribute('data-nav');
      const element = document.getElementById(target);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}
