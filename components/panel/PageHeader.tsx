import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronRightIcon } from '@/components/ui/icons'

/** H1, one line of context and the page's main actions (DESIGN.md §7). */
export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: Array<{ href: string; label: string }> }) {
  return (
    <div className="stack" style={{ ['--gap' as string]: '10px' }}>
      {crumbs && crumbs.length > 0 ? (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => (
            <span key={crumb.href} className="row" style={{ ['--gap' as string]: '6px' }}>
              {index > 0 ? <ChevronRightIcon size={12} /> : null}
              <Link href={crumb.href}>{crumb.label}</Link>
            </span>
          ))}
        </nav>
      ) : null}
      <div className="page-head">
        <div className="titles">
          <h1 className="page-title">{title}</h1>
          {subtitle ? <div className="page-sub">{subtitle}</div> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
    </div>
  )
}
