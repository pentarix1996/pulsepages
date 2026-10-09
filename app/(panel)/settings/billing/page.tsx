import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { planLimit, PLANS, type Plan } from '@shared/plans.ts'
import { BillingManager, type UsageRow } from '@/components/panel/settings/BillingManager'
import { NoOrganization } from '@/components/panel/settings/NoOrganization'
import { getPlanUsage, planChangeEffects } from '@/lib/domain/billing'
import { env } from '@/lib/env'
import { guard, panelContext } from '@/lib/panel/server'
import { settingsScope } from '../_lib/scope'

export const metadata: Metadata = { title: 'Plan and billing' }

export default async function BillingPage() {
  const ctx = await panelContext()
  const scope = await settingsScope()
  if (!scope) return <NoOrganization />
  const organization = scope.current
  const usage = await guard(() => getPlanUsage(ctx, organization.id))
  const plan = organization.plan
  const rows: UsageRow[] = [
    { label: 'Status pages', used: usage.status_pages, limit: planLimit(plan, 'projects') },
    { label: 'Active monitors', used: usage.monitors_active, limit: planLimit(plan, 'monitors') },
    { label: 'Members', used: usage.members + usage.pending_invitations, limit: planLimit(plan, 'members') },
    { label: 'Subscribers on the largest page', used: usage.largest_page?.subscribers ?? 0, limit: planLimit(plan, 'subscribers_per_project') },
    { label: 'Active API keys', used: usage.api_keys_active, limit: planLimit(plan, 'api') === 0 ? 0 : -1 },
    { label: 'Custom domains', used: usage.custom_domains, limit: planLimit(plan, 'custom_domain') === 0 ? 0 : -1 },
  ]
  const effects = Object.fromEntries(PLANS.map((target) => [target, planChangeEffects(usage, plan, target)])) as Record<Plan, string[]>

  return (
    <BillingManager
      key={organization.id}
      organization={{ id: organization.id, name: organization.name, plan }}
      isOwner={hasRole(organization.role, 'owner')}
      billingReady={env.billingMode() === 'demo'}
      usage={rows}
      effects={effects}
    />
  )
}
