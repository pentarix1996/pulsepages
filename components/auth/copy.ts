import type { OrgRole } from '@shared/domain.ts'

/** "an admin", "a viewer": role names inside sentences. */
export const ROLE_ARTICLE_LABEL: Record<OrgRole, string> = {
  viewer: 'a viewer',
  responder: 'a responder',
  admin: 'an admin',
  owner: 'an owner',
}
