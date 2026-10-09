import type { Metadata } from 'next'
import { OrganizationManager } from '@/components/panel/settings/OrganizationManager'
import { NoOrganization } from '@/components/panel/settings/NoOrganization'
import { listMembers } from '@/lib/domain/members'
import { env } from '@/lib/env'
import { guard, panelContext } from '@/lib/panel/server'
import { settingsScope } from '../_lib/scope'

export const metadata: Metadata = { title: 'Organization' }

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const ctx = await panelContext()
  const [scope, { new: openNew }] = await Promise.all([settingsScope(), searchParams])
  if (!scope) return <NoOrganization />
  const { members } = await guard(() => listMembers(ctx, scope.current.id))

  return (
    <OrganizationManager
      key={scope.current.id}
      organization={scope.current}
      organizations={scope.organizations}
      ownerCount={members.filter((member) => member.role === 'owner').length}
      membersWithout2fa={members.filter((member) => member.mfa_enabled === false).length}
      appHost={new URL(env.appUrl()).host}
      openNew={openNew === '1'}
    />
  )
}
