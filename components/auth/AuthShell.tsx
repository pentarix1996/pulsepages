import Link from 'next/link'
import type { ReactNode } from 'react'
import { Banner } from '@/components/ui/Banner'
import { LogoMarkIcon } from '@/components/ui/icons'

/** Centered card used by every auth page and /invite (DESIGN.md: dark ink, one primary action per view). */
export function AuthShell({ title, subtitle, children, footer }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-card">
      <Link href="/" className="auth-logo" aria-label="Upvane home">
        <span className="mark">
          <LogoMarkIcon size={16} strokeWidth={2.3} />
        </span>
        Upvane
      </Link>
      <div className="auth-head">
        <h1 className="auth-title">{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <section className="card">
        <div className="card-b">{children}</div>
      </section>
      {footer ? <div className="auth-foot">{footer}</div> : null}
    </div>
  )
}

/** Inline error at the top of an auth form, announced to screen readers (role="alert"). */
export function AuthError({ message, action }: { message: string | null | undefined; action?: ReactNode }) {
  if (!message) return null
  return (
    <Banner tone="danger" action={action}>
      {message}
    </Banner>
  )
}
