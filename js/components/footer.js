export function renderFooter() {
  const year = new Date().getFullYear();

  return `
    <footer class="landing-footer" id="footer">
      <div class="landing-footer-inner">
        <div class="landing-footer-top">
          <div class="landing-footer-brand">
            <div class="landing-footer-brand-name">
              <div class="landing-nav-logo-icon" style="width:22px;height:22px;font-size:0.6875rem;">P</div>
              PulsePages
            </div>
            <p class="landing-footer-brand-desc">
              Beautiful status pages that build trust with your users. Built by developers, for developers.
            </p>
          </div>
          <div class="landing-footer-column">
            <div class="landing-footer-column-title">Product</div>
            <div class="landing-footer-column-links">
              <a href="#features" class="landing-footer-link">Features</a>
              <a href="#pricing" class="landing-footer-link">Pricing</a>
              <a href="#faq" class="landing-footer-link">FAQ</a>
              <a href="#" class="landing-footer-link">Changelog</a>
            </div>
          </div>
          <div class="landing-footer-column">
            <div class="landing-footer-column-title">Resources</div>
            <div class="landing-footer-column-links">
              <a href="#" class="landing-footer-link">Documentation</a>
              <a href="#" class="landing-footer-link">API Reference</a>
              <a href="#" class="landing-footer-link">Blog</a>
              <a href="#" class="landing-footer-link">Status</a>
            </div>
          </div>
          <div class="landing-footer-column">
            <div class="landing-footer-column-title">Company</div>
            <div class="landing-footer-column-links">
              <a href="#" class="landing-footer-link">About</a>
              <a href="#" class="landing-footer-link">Contact</a>
              <a href="#" class="landing-footer-link">Twitter</a>
              <a href="#" class="landing-footer-link">GitHub</a>
            </div>
          </div>
        </div>
        <div class="landing-footer-bottom">
          <span class="landing-footer-copyright">&copy; ${year} PulsePages. All rights reserved.</span>
          <div class="landing-footer-legal">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  `;
}
