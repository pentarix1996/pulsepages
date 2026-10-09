import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isPlan, PLAN_INFO, planLimit } from '@shared/plans.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { MonitorForm } from '@/components/panel/monitors/MonitorForm'
import { getMonitorFormData } from '@/lib/domain/monitors'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/monitors.css'

export const metadata: Metadata = { title: 'Edit monitor' }

export default async function EditMonitorPage({ params }: { params: Promise<{ projectId: string; monitorId: string }> }) {
  const { projectId, monitorId } = await params
  const ctx = await panelContext()
  const { access, monitor, components } = await guard(() => getMonitorFormData(ctx, projectId, monitorId))
  if (!monitor) notFound()
  const plan = access.organization.plan

  return (
    <div className="main-narrow stack" style={{ ['--gap' as string]: '22px' }}>
      <PageHeader
        title={`Edit ${monitor.name}`}
        subtitle="Changes apply from the next check. History stays as it is."
        crumbs={[
          { href: `/p/${access.project.id}/monitors`, label: 'Monitors' },
          { href: `/p/${access.project.id}/monitors/${monitor.id}`, label: monitor.name },
        ]}
      />
      <MonitorForm
        key={monitor.updated_at}
        projectId={access.project.id}
        monitor={monitor}
        components={components}
        minInterval={planLimit(plan, 'min_interval_seconds')}
        maxRegions={planLimit(plan, 'regions_per_monitor')}
        planName={isPlan(plan) ? PLAN_INFO[plan].name : plan}
      />
    </div>
  )
}
