import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { planLimit } from '@shared/plans.ts'
import { MembersManager } from '@/components/panel/settings/MembersManager'
import { NoOrganization } from '@/components/panel/settings/NoOrganization'
import { listInvitations } from '@/lib/domain/invitations'
import { listMembers } from '@/lib/domain/members'
import { env } from '@/lib/env'
import { guard, panelContext } from '@/lib/panel/server'
import { settingsScope } from '../_lib/scope'

export const metadata: Metadata = { title: 'Members' }

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const ctx = await panelContext()
  const [scope, { invite }] = await Promise.all([settingsScope(), searchParams])
  if (!scope) return <NoOrganization />
  const organization = scope.current
  const isAdmin = hasRole(organization.role, 'admin')
  const [{ members }, invitations] = await Promise.all([
    guard(() => listMembers(ctx, organization.id)),
    isAdmin ? guard(() => listInvitations(ctx, organization.id)) : Promise.resolve([]),
  ])

  return (
    <MembersManager
      key={organization.id}
      organization={organization}
      members={members}
      invitations={invitations}
      memberLimit={planLimit(organization.plan, 'members')}
      emailConfigured={Boolean(env.resendApiKey() || process.env.LOCAL_MAILPIT_URL)}
      openInvite={invite === '1' && isAdmin}
    />
  )
}
