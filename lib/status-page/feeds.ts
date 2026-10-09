// RSS 2.0 and Atom feeds of a status page: the last incidents and maintenance windows, newest first. Pure.
import { COMPONENT_STATUS_LABELS, INCIDENT_STATUS_LABELS, MAINTENANCE_STATUS_LABELS } from '@shared/domain.ts'
import { PAGE_PATHS, pageUrl, type PageLocation } from './links'
import { formatStamp } from './time'
import type { HistoryItem, StatusIncident, StatusMaintenance } from './types'
import { IMPACT_LABELS } from './view'

export const FEED_LIMIT = 50

export interface FeedEntry {
  kind: 'incident' | 'maintenance'
  /** Permalink; also the entry id / guid. */
  url: string
  title: string
  /** When the event started or was announced (ISO 8601). */
  published: string
  /** Last public change (ISO 8601). */
  updated: string
  /** Sort key: incident start or maintenance window start. */
  at: string
  /** Plain text. */
  summary: string
}

export interface FeedDocument {
  title: string
  description: string
  pageUrl: string
  selfUrl: string
  author: string
  updated: string
  entries: FeedEntry[]
}

// Characters outside the XML 1.0 Char production (control characters, lone surrogates, U+FFFE/U+FFFF).
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Escapes text for XML element content and attribute values, dropping characters XML cannot carry. */
export function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function latest(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null
  let bestTime = -Infinity
  for (const value of values) {
    if (!value) continue
    const time = new Date(value).getTime()
    if (Number.isFinite(time) && time > bestTime) {
      best = value
      bestTime = time
    }
  }
  return best
}

function iso(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function utc(value: string): string {
  return formatStamp(value, 'datetime-full-tz', 'UTC')
}

export function incidentEntry(incident: StatusIncident, location: PageLocation, appUrl: string): FeedEntry {
  const update = incident.updates[0]
  const status = INCIDENT_STATUS_LABELS[incident.status] ?? incident.status
  const components = incident.components.map((component) => `${component.name} (${COMPONENT_STATUS_LABELS[component.status] ?? component.status})`)
  const lines = [
    `${status}. ${IMPACT_LABELS[incident.impact] ?? incident.impact}.`,
    update?.message?.trim() ?? '',
    components.length > 0 ? `Affected: ${components.join(', ')}.` : '',
    incident.resolved_at ? `Started ${utc(incident.started_at)}, resolved ${utc(incident.resolved_at)}.` : `Started ${utc(incident.started_at)}.`,
  ]
  const updated = latest(update?.created_at, incident.resolved_at, incident.started_at) ?? incident.started_at
  return {
    kind: 'incident',
    url: pageUrl(location, appUrl, PAGE_PATHS.incident(incident.id)),
    title: incident.title,
    published: iso(incident.started_at),
    updated: iso(updated),
    at: incident.started_at,
    summary: lines.filter(Boolean).join('\n'),
  }
}

export function maintenanceEntry(maintenance: StatusMaintenance, location: PageLocation, appUrl: string): FeedEntry {
  const status = MAINTENANCE_STATUS_LABELS[maintenance.status] ?? maintenance.status
  const newest = maintenance.updates[0]
  const oldest = maintenance.updates[maintenance.updates.length - 1]
  const lines = [
    `${status}. Window: ${utc(maintenance.scheduled_start)} to ${utc(maintenance.scheduled_end)}.`,
    (newest?.message || maintenance.description || '').trim(),
    maintenance.components.length > 0 ? `Components: ${maintenance.components.map((component) => component.name).join(', ')}.` : '',
  ]
  const published = oldest?.created_at ?? maintenance.scheduled_start
  const updated = latest(newest?.created_at, maintenance.actual_start, maintenance.actual_end, published) ?? published
  return {
    kind: 'maintenance',
    url: pageUrl(location, appUrl, PAGE_PATHS.maintenance(maintenance.id)),
    title: `Maintenance: ${maintenance.title}`,
    published: iso(published),
    updated: iso(updated),
    at: maintenance.scheduled_start,
    summary: lines.filter(Boolean).join('\n'),
  }
}

/**
 * Feed entries from the history (incidents and finished or running maintenance) plus upcoming maintenance, newest
 * first by event time, deduplicated, at most `limit`.
 */
export function feedEntries(items: HistoryItem[], upcoming: StatusMaintenance[], location: PageLocation, appUrl: string, limit = FEED_LIMIT): FeedEntry[] {
  const seen = new Set<string>()
  const entries: FeedEntry[] = []
  const add = (entry: FeedEntry) => {
    if (seen.has(entry.url)) return
    seen.add(entry.url)
    entries.push(entry)
  }
  for (const maintenance of upcoming) add(maintenanceEntry(maintenance, location, appUrl))
  for (const item of items) add(item.kind === 'incident' ? incidentEntry(item.item, location, appUrl) : maintenanceEntry(item.item, location, appUrl))
  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit)
}

export function feedUpdated(entries: FeedEntry[], fallback: string): string {
  return iso(latest(...entries.map((entry) => entry.updated)) ?? fallback)
}

export function buildRss(feed: FeedDocument): string {
  const items = feed.entries
    .map(
      (entry) =>
        `<item><title>${xmlEscape(entry.title)}</title><link>${xmlEscape(entry.url)}</link><guid isPermaLink="true">${xmlEscape(entry.url)}</guid>` +
        `<pubDate>${new Date(entry.published).toUTCString()}</pubDate><category>${entry.kind === 'incident' ? 'Incident' : 'Maintenance'}</category>` +
        `<description>${xmlEscape(entry.summary)}</description></item>`,
    )
    .join('\n')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n` +
    `<title>${xmlEscape(feed.title)}</title>\n<link>${xmlEscape(feed.pageUrl)}</link>\n<description>${xmlEscape(feed.description)}</description>\n` +
    `<language>en</language>\n<lastBuildDate>${new Date(feed.updated).toUTCString()}</lastBuildDate>\n<generator>Upvane</generator>\n` +
    `<atom:link href="${xmlEscape(feed.selfUrl)}" rel="self" type="application/rss+xml"/>\n` +
    `${items}${items ? '\n' : ''}</channel>\n</rss>\n`
  )
}

export function buildAtom(feed: FeedDocument): string {
  const entries = feed.entries
    .map(
      (entry) =>
        `<entry><id>${xmlEscape(entry.url)}</id><title type="text">${xmlEscape(entry.title)}</title>` +
        `<link rel="alternate" type="text/html" href="${xmlEscape(entry.url)}"/><published>${entry.published}</published><updated>${entry.updated}</updated>` +
        `<category term="${entry.kind}"/><summary type="text">${xmlEscape(entry.summary)}</summary></entry>`,
    )
    .join('\n')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `<id>${xmlEscape(feed.pageUrl)}</id>\n<title type="text">${xmlEscape(feed.title)}</title>\n<subtitle type="text">${xmlEscape(feed.description)}</subtitle>\n` +
    `<updated>${feed.updated}</updated>\n<link rel="alternate" type="text/html" href="${xmlEscape(feed.pageUrl)}"/>\n` +
    `<link rel="self" type="application/atom+xml" href="${xmlEscape(feed.selfUrl)}"/>\n<author><name>${xmlEscape(feed.author)}</name></author>\n<generator>Upvane</generator>\n` +
    `${entries}${entries ? '\n' : ''}</feed>\n`
  )
}
