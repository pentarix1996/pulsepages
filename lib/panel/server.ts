import 'server-only'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { requireProject, type ProjectAccess } from '@/lib/domain/access'
import { userContext, type DomainContext } from '@/lib/domain/context'
import { isDomainError } from '@/lib/domain/errors'
import type { OrgRole } from '@shared/domain.ts'

/** Path of the current request (set by proxy.ts as x-upvane-path). */
export async function currentPath(): Promise<string> {
  return (await headers()).get('x-upvane-path') ?? '/'
}

/** Domain context for Server Components; signed-out visitors go to /login?next=<path>. Cached per request. */
export const panelContext = cache(async (): Promise<DomainContext> => {
  try {
    return await userContext()
  } catch {
    redirect(`/login?next=${encodeURIComponent(await currentPath())}`)
  }
})

/** Project access for pages under /p/[projectId]; missing or foreign projects render the 404 page. */
export const projectAccess = cache(async (projectId: string, minRole: OrgRole = 'viewer'): Promise<ProjectAccess> => {
  const ctx = await panelContext()
  return guard(() => requireProject(ctx, projectId, minRole))
})

/** Runs a domain read and turns not-found/forbidden into the 404 page and sign-out into /login. */
export async function guard<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === 'not_found' || error.code === 'forbidden') notFound()
      if (error.code === 'unauthorized') redirect('/login')
    }
    throw error
  }
}
