'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Route tabs; the current one is marked with aria-current. */
export function LinkTabs({ tabs, label }: { tabs: Array<{ href: string; label: string; exact?: boolean }>; label: string }) {
  const pathname = usePathname()
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined}>
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
