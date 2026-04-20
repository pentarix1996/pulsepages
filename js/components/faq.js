export function renderFaq() {
  const faqs = [
    {
      question: 'How does PulsePages work?',
      answer: 'Create an account, add your project, define your service components (API, database, etc.), and you instantly get a public status page URL. Update component statuses from your dashboard and your users see changes in real time.'
    },
    {
      question: 'Is there really a free plan?',
      answer: 'Yes! The free plan includes 1 project with 3 components and 7-day incident history. Perfect for side projects and MVPs. No credit card required — start in seconds.'
    },
    {
      question: 'Can I use a custom domain?',
      answer: 'Custom domains are available on Pro and Business plans. You can point your own domain (e.g., status.yourapp.com) to your PulsePages status page with a simple CNAME record.'
    },
    {
      question: 'How do I update the status of my services?',
      answer: 'Through the dashboard — click on any component and change its status with one click. Pro and Business plans also get API access, so you can automate status updates from your CI/CD pipeline or monitoring tools.'
    },
    {
      question: 'What happens if I exceed my plan limits?',
      answer: 'We will notify you when you approach your limits. You can upgrade at any time and the change takes effect immediately. We never delete your data — your existing components and history are always safe.'
    },
    {
      question: 'Do you offer refunds?',
      answer: 'Yes. We offer a 14-day money-back guarantee on all paid plans. If PulsePages is not the right fit, contact us and we will process your refund — no questions asked.'
    },
    {
      question: 'Is my data secure?',
      answer: 'Security is a core principle. We use input sanitization, XSS prevention, secure session management, and follow OWASP best practices. All data is encrypted in transit. We never sell or share your data.'
    }
  ];

  return `
    <section class="faq" id="faq">
      <div class="faq-header">
        <span class="features-label">FAQ</span>
        <h2 class="faq-title">Frequently asked<br>questions</h2>
      </div>
      <div class="faq-list">
        ${faqs.map((faq, i) => `
          <div class="faq-item" id="faq-item-${i}">
            <button class="faq-question" data-faq="${i}" id="faq-btn-${i}">
              <span>${faq.question}</span>
              <span class="faq-question-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </span>
            </button>
            <div class="faq-answer">
              <p class="faq-answer-text">${faq.answer}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

export function initFaq() {
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = btn.dataset.faq;
      const item = document.getElementById(`faq-item-${index}`);
      const isActive = item.classList.contains('active');

      document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('active'));

      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
}
