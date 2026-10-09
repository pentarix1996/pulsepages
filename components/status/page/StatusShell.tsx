// Frame shared by every public status page route: theme bootstrap, header (brand, theme, subscribe), footer.
import type { CSSProperties, ReactNode } from 'react'
import type { Theme } from '@shared/domain.ts'
import { InfoIcon } from '@/components/ui/icons'
import { brandStyle } from '@/lib/status-page/brand'
import { PAGE_PATHS, pageHref, publicApiPath, type PageLocation } from '@/lib/status-page/links'
import type { StatusPageData } from '@/lib/status-page/types'
import { PageTimeZone } from '../LocalTime'
import { StatusBootstrap } from '../StatusBootstrap'
import { SubscribePopover, type FeedLink, type SubscribeComponentOption } from '../Subscribe'
import { ThemeToggle } from '../ThemeToggle'
import { TimeZoneSelect } from '../TimeZoneSelect'
import { STATUS_ROOT_ATTRIBUTE } from '../storage'

export interface ShellProject {
  id: string
  name: string
  logo_url: string | null
  brand_color: string | null
  theme_default: Theme
  timezone: string
  hide_powered_by: boolean
}

export function subscribeOptions(page: StatusPageData): SubscribeComponentOption[] {
  const groups = new Map(page.groups.map((group) => [group.id, group.name]))
  return page.components.map((component) => ({ id: component.id, name: component.name, group: component.group_id ? (groups.get(component.group_id) ?? null) : null }))
}

export function feedLinks(location: PageLocation): FeedLink[] {
  return [
    { label: 'RSS feed', href: pageHref(location, PAGE_PATHS.rss), display: 'feed.rss' },
    { label: 'Atom feed', href: pageHref(location, PAGE_PATHS.atom), display: 'feed.atom' },
    { label: 'Current status as JSON', href: pageHref(location, PAGE_PATHS.summaryJson), display: 'api/v2/summary.json' },
  ]
}

function Brand({ project, location }: { project: Pick<ShellProject, 'name' | 'logo_url'>; location: PageLocation }) {
  return (
    <a className="sp-brand" href={pageHref(location)} aria-label={`${project.name} status home`}>
      {project.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- customer logo from storage, any size
        <img className="sp-brand-logo" src={project.logo_url} alt="" />
      ) : (
        <span className="sp-brand-mark" aria-hidden="true">
          {project.name.trim().charAt(0).toUpperCase() || 'S'}
        </span>
      )}
      {project.logo_url ? <span className="sr-only">{project.name}</span> : <span className="sp-brand-name">{project.name}</span>}
      <span className="sp-brand-sub">System status</span>
    </a>
  )
}

export function StatusShell({
  project,
  location,
  page,
  appUrl,
  children,
}: {
  project: ShellProject
  location: PageLocation
  /** Full page data enables the subscribe popover (components to follow). */
  page: StatusPageData | null
  appUrl: string
  children: ReactNode
}) {
  const style = brandStyle(project.brand_color) as CSSProperties
  return (
    <div className="sp" {...{ [STATUS_ROOT_ATTRIBUTE]: '' }} style={style} suppressHydrationWarning>
      <StatusBootstrap projectId={project.id} themeDefault={project.theme_default} />
      <PageTimeZone timeZone={project.timezone}>
        <header className="sp-wrap sp-head">
          <Brand project={project} location={location} />
          <div className="sp-head-actions">
            <ThemeToggle projectId={project.id} themeDefault={project.theme_default} />
            {page ? <SubscribePopover endpoint={publicApiPath(location, 'subscribe')} components={subscribeOptions(page)} feeds={feedLinks(location)} /> : null}
          </div>
        </header>
        {children}
        <footer className="sp-wrap sp-foot">
          <TimeZoneSelect />
          <div className="sp-foot-links">
            {page ? (
              <>
                <a href={pageHref(location, PAGE_PATHS.history)}>Incident history</a>
                <a href={pageHref(location, PAGE_PATHS.rss)}>RSS</a>
                <a href={pageHref(location, PAGE_PATHS.summaryJson)}>Status API</a>
              </>
            ) : null}
            {project.hide_powered_by ? null : (
              <a className="sp-powered" href={appUrl} rel="noopener">
                Powered by Upvane
              </a>
            )}
          </div>
        </footer>
      </PageTimeZone>
    </div>
  )
}

/** Small "i" with a tooltip, for component descriptions. */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="sp-info" tabIndex={0} aria-label={text}>
      <InfoIcon size={14} />
      <span className="sp-tip" aria-hidden="true">
        {text}
      </span>
    </span>
  )
}
