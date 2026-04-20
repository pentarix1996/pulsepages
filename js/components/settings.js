import { auth } from '../auth.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { escapeHTML, sanitizeInput, validateEmail } from '../utils/security.js';

export function renderSettings() {
  const user = auth.getCurrentUser();
  if (!user) return '';

  const planLabels = { free: 'Free', pro: 'Pro', business: 'Business' };
  const planDescriptions = {
    free: '1 project, 3 components, 7-day history',
    pro: '5 projects, 10 components, 90-day history',
    business: 'Unlimited projects, unlimited components, 1-year history'
  };

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-description">Manage your account and subscription.</p>
      </div>
    </div>

    <div class="settings-sections">
      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Profile</h2>
          <p class="settings-section-desc">Your personal information.</p>
        </div>
        <div class="settings-section-body">
          <div class="input-group">
            <label class="input-label" for="settings-name">Full Name</label>
            <input type="text" class="input-field" id="settings-name" value="${escapeHTML(user.name)}" maxlength="50">
          </div>
          <div class="input-group">
            <label class="input-label" for="settings-email">Email Address</label>
            <input type="email" class="input-field" id="settings-email" value="${escapeHTML(user.email)}" maxlength="100">
          </div>
          <div id="settings-profile-error" style="display:none;font-size:0.8125rem;"></div>
          <div id="settings-profile-success" style="display:none;color:var(--status-emerald);font-size:0.8125rem;"></div>
        </div>
        <div class="settings-section-footer">
          <button class="btn btn-primary" id="settings-save-profile">Save Changes</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Subscription</h2>
          <p class="settings-section-desc">Manage your plan and billing.</p>
        </div>
        <div class="settings-section-body">
          <div class="plan-card">
            <div class="plan-card-info">
              <div class="plan-card-name">
                ${escapeHTML(planLabels[user.plan] || 'Free')} Plan
                ${user.plan !== 'free' ? `<span class="badge badge-brand" style="margin-left:var(--space-8);">Active</span>` : ''}
              </div>
              <p class="plan-card-description">${escapeHTML(planDescriptions[user.plan] || planDescriptions.free)}</p>
            </div>
            ${user.plan === 'free' ? `
              <button class="btn btn-primary btn-sm" id="settings-upgrade">Upgrade to Pro</button>
            ` : `
              <button class="btn btn-ghost btn-sm" id="settings-manage-billing">Manage Billing</button>
            `}
          </div>

          ${user.plan === 'free' ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-16);margin-top:var(--space-16);">
              <div class="card" style="cursor:pointer;border-color:var(--accent-violet);" id="plan-select-pro">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-12);">
                  <span style="font-size:1rem;font-weight:var(--fw-semibold);color:var(--text-primary);">Pro</span>
                  <span class="badge badge-brand">Recommended</span>
                </div>
                <span style="font-size:2rem;font-weight:var(--fw-semibold);color:var(--text-primary);">$9</span>
                <span style="font-size:0.8125rem;color:var(--text-quaternary);">/month</span>
                <p style="font-size:0.8125rem;color:var(--text-tertiary);margin-top:var(--space-12);">5 projects, 10 components each, custom domain, API access.</p>
              </div>
              <div class="card" style="cursor:pointer;" id="plan-select-business">
                <div style="margin-bottom:var(--space-12);">
                  <span style="font-size:1rem;font-weight:var(--fw-semibold);color:var(--text-primary);">Business</span>
                </div>
                <span style="font-size:2rem;font-weight:var(--fw-semibold);color:var(--text-primary);">$29</span>
                <span style="font-size:0.8125rem;color:var(--text-quaternary);">/month</span>
                <p style="font-size:0.8125rem;color:var(--text-tertiary);margin-top:var(--space-12);">Unlimited everything, white-label, priority support.</p>
              </div>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title" style="color:var(--status-red);">Danger Zone</h2>
          <p class="settings-section-desc">Irreversible and destructive actions.</p>
        </div>
        <div class="settings-section-body">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div>
              <p style="font-size:0.9375rem;font-weight:var(--fw-medium);color:var(--text-primary);">Reset all data</p>
              <p style="font-size:0.8125rem;color:var(--text-tertiary);">Delete all projects, incidents, and reset to demo state.</p>
            </div>
            <button class="btn btn-danger btn-sm" id="settings-reset">Reset Data</button>
          </div>
          <div class="divider"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div>
              <p style="font-size:0.9375rem;font-weight:var(--fw-medium);color:var(--text-primary);">Sign out</p>
              <p style="font-size:0.8125rem;color:var(--text-tertiary);">End your current session.</p>
            </div>
            <button class="btn btn-ghost btn-sm" id="settings-logout">Log out</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function initSettings() {
  const saveProfile = document.getElementById('settings-save-profile');
  const errorDiv = document.getElementById('settings-profile-error');
  const successDiv = document.getElementById('settings-profile-success');

  if (saveProfile) {
    saveProfile.addEventListener('click', async () => {
      const name = document.getElementById('settings-name').value;
      const email = document.getElementById('settings-email').value;

      saveProfile.innerText = 'Saving...';
      saveProfile.disabled = true;

      const result = await auth.updateProfile({ name, email });
      
      saveProfile.innerText = 'Save Changes';
      saveProfile.disabled = false;

      if (result.success) {
        if (successDiv) {
          successDiv.textContent = 'Profile updated successfully.';
          successDiv.style.display = 'block';
          setTimeout(() => { successDiv.style.display = 'none'; }, 3000);
        }
      } else {
        if (errorDiv) {
          errorDiv.textContent = result.error;
          errorDiv.style.display = 'block';
          errorDiv.style.color = 'var(--status-red)';
          setTimeout(() => { errorDiv.style.display = 'none'; }, 4000);
        }
      }
    });
  }

  const upgradeBtn = document.getElementById('settings-upgrade');
  const proCard = document.getElementById('plan-select-pro');
  const businessCard = document.getElementById('plan-select-business');
  const manageBilling = document.getElementById('settings-manage-billing');

  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', async () => {
      upgradeBtn.innerText = 'Processing...';
      await auth.changePlan('pro');
      showToast('Plan upgraded to Pro!');
      router.navigate('/settings');
    });
  }

  if (proCard) {
    proCard.addEventListener('click', async () => {
      await auth.changePlan('pro');
      showToast('Plan upgraded to Pro!');
      router.navigate('/settings');
    });
  }

  if (businessCard) {
    businessCard.addEventListener('click', async () => {
      await auth.changePlan('business');
      showToast('Plan upgraded to Business!');
      router.navigate('/settings');
    });
  }

  if (manageBilling) {
    manageBilling.addEventListener('click', () => {
      showToast('Stripe billing portal would open here.');
    });
  }

  const resetBtn = document.getElementById('settings-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Are you sure? This will delete ALL your projects and incidents. Your account will NOT be deleted.')) {
        const user = auth.getCurrentUser();
        if (user) {
          store.resetUserData(user.id);
          showToast('All your projects and incidents have been reset.');
          setTimeout(() => router.navigate('/dashboard'), 1000);
        }
      }
    });
  }

  const logoutBtn = document.getElementById('settings-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await auth.logout();
      router.navigate('/');
    });
  }
}

function showToast(message) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span class="toast-icon" style="color:var(--status-emerald);">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </span>
    <div class="toast-content">
      <div class="toast-title">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
