import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { AuditLogView } from '@/components/panel/settings/AuditLogView'
import { NoOrganization } from '@/components/panel/settings/NoOrganization'
import { Card, EmptyState } from '@/components/ui/Card'
import { AUDIT_ACTION_GROUPS, auditExportAllowed, listAuditLog } from '@/lib/domain/audit-log'
import { auditLogFilters } from '@/lib/domain/schemas/organizations'
import { guard, panelContext } from '@/lib/panel/server'
import { settingsScope } from '../_lib/scope'

export const metadata: Metadata = { title: 'Audit log' }

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string; from?: string; to?: string; cursor?: string }> }) {
  const ctx = await panelContext()
  const [scope, query] = await Promise.all([settingsScope(), searchParams])
  if (!scope) return <NoOrganization />
  const organization = scope.current
  if (!hasRole(organization.role, 'admin')) {
    return (
      <Card>
        <EmptyState title="Admins see the audit log" description={`Ask an admin of ${organization.name} if you need to know who changed something.`} center />
      </Card>
    )
  }
  const parsed = auditLogFilters.safeParse({ action: query.action, actor: query.actor, from: query.from, to: query.to })
  const filters = parsed.success ? parsed.data : {}
  const { entries, nextCursor } = await guard(() => listAuditLog(ctx, organization.id, filters, query.cursor ?? null))
  return (
    <AuditLogView
      key={organization.id}
      organizationId={organization.id}
      entries={entries}
      nextCursor={nextCursor}
      isFirstPage={!query.cursor}
      filters={{ action: filters.action ?? '', actor: filters.actor ?? '', from: filters.from ?? '', to: filters.to ?? '' }}
      groups={AUDIT_ACTION_GROUPS}
      exportAllowed={auditExportAllowed(organization.plan)}
    />
  )
}
