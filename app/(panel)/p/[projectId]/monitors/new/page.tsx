import type { Metadata } from 'next'
import { MONITOR_TYPES, type MonitorType } from '@shared/domain.ts'
import { isPlan, PLAN_INFO, planLimit } from '@shared/plans.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { MonitorForm } from '@/components/panel/monitors/MonitorForm'
import { getMonitorFormData } from '@/lib/domain/monitors'
import { guard, panelContext } from '@/lib/panel/server'
import '@/styles/panel/monitors.css'

export const metadata: Metadata = { title: 'New monitor' }

export default async function NewMonitorPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ type?: string }> }) {
  const { projectId } = await params
  const { type } = await searchParams
  const ctx = await panelContext()
  const { access, components } = await guard(() => getMonitorFormData(ctx, projectId))
  const plan = access.organization.plan
  const initialType = (MONITOR_TYPES as readonly string[]).includes(type ?? '') ? (type as MonitorType) : undefined

  return (
    <div className="main-narrow stack" style={{ ['--gap' as string]: '22px' }}>
      <PageHeader
        title="New monitor"
        subtitle="Upvane checks it from the regions you pick and changes component status only after the regions confirm."
        crumbs={[{ href: `/p/${access.project.id}/monitors`, label: 'Monitors' }]}
      />
      <MonitorForm
        projectId={access.project.id}
        monitor={null}
        components={components}
        minInterval={planLimit(plan, 'min_interval_seconds')}
        maxRegions={planLimit(plan, 'regions_per_monitor')}
        planName={isPlan(plan) ? PLAN_INFO[plan].name : plan}
        initialType={initialType}
      />
    </div>
  )
}
