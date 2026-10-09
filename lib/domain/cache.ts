import 'server-only'
import { revalidateTag } from 'next/cache'

/** Cache tag of a public status page (spec §7). */
export function statusPageTag(organizationSlug: string, projectSlug: string): string {
  return `status-page:${organizationSlug.toLowerCase()}/${projectSlug.toLowerCase()}`
}

/**
 * Expires the cached public page right away after a change made in Upvane (incidents, maintenance, components,
 * settings). Changes made by monitors inside the database are picked up by the 30 second TTL.
 */
export function invalidateStatusPage(organizationSlug: string, projectSlug: string): void {
  try {
    revalidateTag(statusPageTag(organizationSlug, projectSlug), { expire: 0 })
  } catch {
    // Outside a request (tests, scripts) there is no cache to invalidate.
  }
}
