import 'server-only'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { ORG_COOKIE } from '@/components/panel/settings/org-cookie'
import { resolveOrganizationScope, type OrganizationScope } from '@/lib/domain/organizations'
import { panelContext } from '@/lib/panel/server'

/** Organization the settings pages act on (upv_org → organization of upv_project → first membership). Cached per request. */
export const settingsScope = cache(async (): Promise<OrganizationScope | null> => {
  const ctx = await panelContext()
  const store = await cookies()
  return resolveOrganizationScope(ctx, {
    organizationId: store.get(ORG_COOKIE)?.value ?? null,
    projectId: store.get('upv_project')?.value ?? null,
  })
})
