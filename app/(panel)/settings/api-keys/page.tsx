import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { planAllows } from '@shared/plans.ts'
import { ApiKeysManager } from '@/components/panel/settings/ApiKeysManager'
import { NoOrganization } from '@/components/panel/settings/NoOrganization'
import { Card, EmptyState } from '@/components/ui/Card'
import { listApiKeys } from '@/lib/domain/api-keys'
import { env } from '@/lib/env'
import { guard, panelContext } from '@/lib/panel/server'
import { settingsScope } from '../_lib/scope'

export const metadata: Metadata = { title: 'API keys' }

export default async function ApiKeysPage() {
  const ctx = await panelContext()
  const scope = await settingsScope()
  if (!scope) return <NoOrganization />
  const organization = scope.current
  if (!hasRole(organization.role, 'admin')) {
    return (
      <Card>
        <EmptyState title="Admins manage API keys" description={`Ask an admin of ${organization.name} for a key, or switch to an organization where you are an admin.`} center />
      </Card>
    )
  }
  const [keys, projects] = await Promise.all([
    guard(() => listApiKeys(ctx, organization.id)),
    ctx.db.from('projects').select('id, name, slug').eq('organization_id', organization.id).order('name'),
  ])
  return (
    <ApiKeysManager
      key={organization.id}
      organization={{ id: organization.id, name: organization.name, personal: organization.personal }}
      keys={keys}
      projects={(projects.data ?? []) as Array<{ id: string; name: string; slug: string }>}
      apiAllowed={planAllows(organization.plan, 'api')}
      apiUrl={`${env.appUrl()}/api/v1`}
    />
  )
}
