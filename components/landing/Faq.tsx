'use client'

import { useState } from 'react'

const faqs = [
  { q: 'How quickly can I set up a status page?', a: 'You can have your status page live in under 30 seconds. Just sign up, create a project, add your components, and share the public URL.' },
  { q: 'Can I use my own domain?', a: 'Yes! Pro and Business plans support custom domains. Simply add a CNAME record pointing to our servers and configure it in your project settings.' },
  { q: 'How does the API work?', a: 'Our REST API allows you to programmatically update component statuses. Perfect for CI/CD pipelines and automated monitoring. API access is available on Pro and Business plans.' },
  { q: 'Is there a free plan?', a: 'The Free plan is available forever with 1 project and 3 components. Pro and Business plans can be purchased directly — no credit card required to sign up.' },
  { q: 'What happens when I exceed my plan limits?', a: "You'll see a notification when you reach your limits. You can upgrade at any time to unlock more projects and components. Your existing data is never deleted." },
  { q: 'Can I downgrade my plan?', a: 'Yes, you can downgrade at any time. Your extra projects will become read-only until you remove them to fit within the new plan limits.' },
  { q: 'Do you offer refunds?', a: 'We offer a 30-day money-back guarantee on all paid plans. If you are not satisfied, contact our support team for a full refund.' },
]

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="faq" id="faq">
      <div className="faq-header">
        <h2 className="faq-title">Frequently asked questions</h2>
        <p className="faq-subtitle">Everything you need to know about PulsePages.</p>
      </div>
      <div className="faq-list">
        {faqs.map((faq, index) => (
          <div className={`faq-item ${openIndex === index ? 'active' : ''}`} key={index}>
            <a
              className="faq-question"
              href="#"
              role="button"
              onClick={(e) => { e.preventDefault(); setOpenIndex(openIndex === index ? null : index) }}
              aria-expanded={openIndex === index}
            >
              {faq.q}
              <svg
                className="faq-question-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </a>
            <div className="faq-answer">
              <p className="faq-answer-text">{faq.a}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
