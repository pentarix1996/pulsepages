import Link from 'next/link'
import { ButtonLink } from '@/components/ui/Button'
import { LogoMarkIcon } from '@/components/ui/icons'

export function Logo({ className }: { className?: string }) {
  return (
    <Link className={['lp-logo', className].filter(Boolean).join(' ')} href="/" aria-label="Upvane home">
      <span className="lp-mark" aria-hidden="true">
        <LogoMarkIcon size={18} strokeWidth={2.2} />
      </span>
      <span>Upvane</span>
    </Link>
  )
}

/**
 * Sticky, translucent site navigation shared by the landing and the docs. On the landing, section links stay on the
 * page; elsewhere they point back to it.
 */
export function SiteNav({ current }: { current?: 'docs' }) {
  const home = current ? '/' : ''
  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav-in">
        <Logo />
        <nav className="lp-nav-links" aria-label="Main">
          <Link href={`${home}#product`}>Product</Link>
          <Link href={`${home}#pricing`}>Pricing</Link>
          <Link href="/docs/api" aria-current={current === 'docs' ? 'page' : undefined}>
            Docs
          </Link>
        </nav>
        <div className="lp-nav-actions">
          <Link className="lp-signin" href="/login">
            Sign in
          </Link>
          <ButtonLink variant="primary" href="/register" className="lp-nav-cta">
            Start free
          </ButtonLink>
        </div>
      </div>
    </header>
  )
}
