export function renderPricing() {
  return `
    <section class="pricing" id="pricing">
      <div class="pricing-header">
        <span class="features-label">Pricing</span>
        <h2 class="pricing-title">Simple, transparent pricing</h2>
        <p class="pricing-subtitle">Start free. Upgrade when you need more. No hidden fees, no surprises.</p>
        <div class="pricing-toggle">
          <span class="pricing-toggle-label active" id="pricing-monthly-label">Monthly</span>
          <div class="pricing-toggle-switch" id="pricing-toggle" role="switch" aria-checked="false" tabindex="0"></div>
          <span class="pricing-toggle-label" id="pricing-annual-label">Annual</span>
          <span class="pricing-save">Save 20%</span>
        </div>
      </div>
      <div class="pricing-grid">
        <div class="pricing-card" id="pricing-free">
          <div class="pricing-card-name">Free</div>
          <p class="pricing-card-description">For side projects and personal use. Get started instantly.</p>
          <div class="pricing-card-price">
            <span class="pricing-card-amount" data-monthly="0" data-annual="0">$0</span>
            <span class="pricing-card-period">/month</span>
          </div>
          <div class="pricing-card-annual" data-annual-text="">&nbsp;</div>
          <div class="pricing-card-features">
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>1 project</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>3 components</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>7-day incident history</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>Public status page</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-x">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </span>
              <span style="color: var(--text-quaternary)">Custom domain</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-x">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </span>
              <span style="color: var(--text-quaternary)">API access</span>
            </div>
          </div>
          <a href="#/register" class="btn btn-ghost btn-block" id="pricing-free-cta">Get started</a>
        </div>

        <div class="pricing-card pricing-card-featured" id="pricing-pro">
          <div class="pricing-card-popular">Most Popular</div>
          <div class="pricing-card-name">Pro</div>
          <p class="pricing-card-description">For growing teams and indie hackers shipping real products.</p>
          <div class="pricing-card-price">
            <span class="pricing-card-amount" data-monthly="9" data-annual="7">$9</span>
            <span class="pricing-card-period">/month</span>
          </div>
          <div class="pricing-card-annual" data-annual-text="$84/year (save $24)">&nbsp;</div>
          <div class="pricing-card-features">
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>5 projects</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>10 components per project</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>90-day incident history</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>Custom domain</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>No PulsePages branding</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>API access</span>
            </div>
          </div>
          <a href="#/register" class="btn btn-primary btn-block" id="pricing-pro-cta">Select</a>
        </div>

        <div class="pricing-card" id="pricing-business">
          <div class="pricing-card-name">Business</div>
          <p class="pricing-card-description">For teams that need scale, white-label, and priority support.</p>
          <div class="pricing-card-price">
            <span class="pricing-card-amount" data-monthly="29" data-annual="24">$29</span>
            <span class="pricing-card-period">/month</span>
          </div>
          <div class="pricing-card-annual" data-annual-text="$288/year (save $60)">&nbsp;</div>
          <div class="pricing-card-features">
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>Unlimited projects</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>Unlimited components</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>1-year incident history</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>White-label branding</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>Custom templates</span>
            </div>
            <div class="pricing-feature">
              <span class="pricing-feature-icon pricing-feature-icon-check">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </span>
              <span>Priority support</span>
            </div>
          </div>
          <a href="#/register" class="btn btn-ghost btn-block" id="pricing-business-cta">Select</a>
        </div>
      </div>
    </section>
  `;
}

export function initPricing() {
  const toggle = document.getElementById('pricing-toggle');
  const monthlyLabel = document.getElementById('pricing-monthly-label');
  const annualLabel = document.getElementById('pricing-annual-label');

  if (!toggle) return;

  let isAnnual = false;

  toggle.addEventListener('click', () => {
    isAnnual = !isAnnual;
    toggle.classList.toggle('active', isAnnual);
    toggle.setAttribute('aria-checked', isAnnual);
    monthlyLabel.classList.toggle('active', !isAnnual);
    annualLabel.classList.toggle('active', isAnnual);

    document.querySelectorAll('.pricing-card-amount').forEach(el => {
      const monthly = el.dataset.monthly;
      const annual = el.dataset.annual;
      el.textContent = `$${isAnnual ? annual : monthly}`;
    });

    document.querySelectorAll('[data-annual-text]').forEach(el => {
      const text = el.dataset.annualText;
      el.textContent = isAnnual && text ? text : '\u00a0';
    });
  });

  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle.click();
    }
  });
}
