// Organization in scope for /settings/* (cookie contract shared by the server and the switcher).
// `upv_org` = organization id. Read by app/(panel)/settings/_lib/scope.ts; when it is missing or stale the scope falls
// back to the organization of `upv_project` (last opened status page), then to the first membership.

export const ORG_COOKIE = 'upv_org'
const ONE_YEAR = 60 * 60 * 24 * 365

/** Browser only: remembers the organization the settings pages act on. */
export function rememberOrganization(organizationId: string): void {
  document.cookie = `${ORG_COOKIE}=${encodeURIComponent(organizationId)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
}

/** Browser only: forgets it (after leaving or deleting the organization). */
export function forgetOrganization(): void {
  document.cookie = `${ORG_COOKIE}=; path=/; max-age=0; samesite=lax`
}
