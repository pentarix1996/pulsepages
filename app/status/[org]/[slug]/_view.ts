import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { env } from '@/lib/env'
import { loadStatusView, pageLocation, currentRequest, type StatusView } from '@/lib/status-page/access'
import { accessExchangeHref, type PageLocation } from '@/lib/status-page/links'
import { pageTitle } from '@/lib/status-page/view'

export type PageView = Extract<StatusView, { kind: 'page' }>
export type GateView = Extract<StatusView, { kind: 'gate' }>

/** Resolves the view for a status page route: 404 for unknown pages, access-link exchange when the URL carries one. */
export async function statusRoute(org: string, slug: string, searchParams: Record<string, string | string[] | undefined>, subPath: string): Promise<PageView | GateView> {
  const view = await loadStatusView(org, slug)
  if (view.kind === 'not_found') notFound()
  const token = searchParams.access_token
  if (typeof token === 'string' && token) redirect(accessExchangeHref(view.location, token, subPath || '/'))
  return view
}

export function appUrl(): string {
  return env.appUrl()
}

export async function titleFor(org: string, slug: string, suffix?: string): Promise<{ title: { absolute: string }; robots?: { index: boolean } }> {
  const view = await loadStatusView(org, slug)
  if (view.kind === 'not_found') return { title: { absolute: 'Status page not found' }, robots: { index: false } }
  const name = view.kind === 'page' ? pageTitle(view.page.project) : pageTitle(view.stub)
  return { title: { absolute: suffix ? `${suffix} · ${name}` : name }, robots: view.kind === 'page' && view.access === 'public' ? undefined : { index: false } }
}

export { currentRequest, pageLocation }
export type { PageLocation }
