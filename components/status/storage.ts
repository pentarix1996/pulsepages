// localStorage keys shared by the inline bootstrap script and the client components.

/** Theme chosen by the visitor, per page (DESIGN.md §2: "la elección se guarda en localStorage por página"). */
export function themeStorageKey(projectId: string): string {
  return `upvane-status-theme:${projectId}`
}

/** Time zone chosen by the visitor, shared by every status page. */
export const TIME_ZONE_STORAGE_KEY = 'upvane-status-tz'

/** Root element of the status page (carries `.sp` and `.dark`). */
export const STATUS_ROOT_ATTRIBUTE = 'data-sp-root'
