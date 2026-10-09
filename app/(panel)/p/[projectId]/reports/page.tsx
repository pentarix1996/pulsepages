import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { PeriodPicker, SlosCard } from '@/components/panel/reports/ReportsControls'
import { IncidentTable, ReportKpis, UptimeTable } from '@/components/panel/reports/ReportTables'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DownloadIcon, FileTextIcon } from '@/components/ui/icons'
import { incidentPublishedAt, metricsForRange } from '@/lib/domain/metrics'
import { parseReportPeriod, previousMonth, recentMonths } from '@/lib/domain/schemas/metrics'
import { listSlos } from '@/lib/domain/slos'
import { formatDate } from '@/lib/format'
import { guard, panelContext, projectAccess } from '@/lib/panel/server'
import '@/styles/panel/reports.css'

export const metadata: Metadata = { title: 'Reports' }

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ period?: string; month?: string }> }) {
  const { projectId } = await params
  const query = await searchParams
  const access = await projectAccess(projectId)
  const ctx = await panelContext()
  const id = access.project.id
  const timeZone = access.project.timezone || 'UTC'
  const period = parseReportPeriod(query, timeZone)
  const [metrics, slos, components] = await Promise.all([
    guard(() => metricsForRange(ctx, access, period.from, period.to)),
    guard(() => listSlos(ctx, id)),
    ctx.db.from('components').select('id, name').eq('project_id', id).order('position').order('name'),
  ])
  const publishedAt = await incidentPublishedAt(ctx, id, metrics.incidents.list.map((incident) => incident.id))
  const pageSlo = slos.find((slo) => slo.component_id === null) ?? null
  const range = `from=${encodeURIComponent(period.from.toISOString())}&to=${encodeURIComponent(period.to.toISOString())}`
  const slaMonth = period.month ?? previousMonth(timeZone)

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${period.label}: ${formatDate(period.from, { timeZone })} to ${formatDate(period.to, { timeZone })}, ${timeZone.replace(/_/g, ' ')}.`}
        actions={
          <>
            <ButtonLink href={`/api/app/projects/${id}/reports/export?kind=uptime&${range}`} prefetch={false} icon={<DownloadIcon size={14} />}>
              Uptime CSV
            </ButtonLink>
            <ButtonLink href={`/api/app/projects/${id}/reports/export?kind=incidents&${range}`} prefetch={false} icon={<DownloadIcon size={14} />}>
              Incidents CSV
            </ButtonLink>
            <ButtonLink variant="primary" href={`/p/${id}/reports/sla?month=${slaMonth}`} icon={<FileTextIcon size={14} />}>
              Monthly SLA report
            </ButtonLink>
          </>
        }
      />
      <PeriodPicker period={period.kind === 'rolling' ? period.key : null} month={period.month} months={recentMonths(timeZone)} />
      <ReportKpis metrics={metrics} sloTarget={pageSlo?.target ?? null} />
      <SlosCard projectId={id} slos={slos} components={(components.data ?? []) as Array<{ id: string; name: string }>} canEdit={hasRole(access.role, 'admin')} />
      <Card>
        <CardHeader title="Uptime by component" description="Partial outages and degraded performance count as set on the status page settings." />
        <UptimeTable metrics={metrics} />
      </Card>
      <Card>
        <CardHeader title="Incidents" description="Acknowledged and resolved times count from detection. Customers saw it from publication to resolution." />
        <IncidentTable metrics={metrics} publishedAt={publishedAt} timeZone={timeZone} projectId={id} />
      </Card>
    </>
  )
}
