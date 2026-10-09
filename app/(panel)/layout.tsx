import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { ACTIVE_INCIDENT_STATUSES } from '@shared/domain.ts'
import { statusPageUrl } from '@shared/alerts/message.ts'
import { PanelShell } from '@/components/panel/Shell'
import type { ShellCounts, ShellOrganization, ShellProject } from '@/components/panel/types'
import { listMemberships } from '@/lib/domain/access'
import { env } from '@/lib/env'
import { currentPath, panelContext } from '@/lib/panel/server'
import '@/styles/panel.css'

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const ctx = await panelContext()
  if (ctx.actor.type !== 'user') redirect('/login')
  const path = await currentPath()

  // MFA: a user with a verified factor must complete the second step (aal2) before using the dashboard.
  const { data: aal } = await ctx.db.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    redirect(`/login/verify?next=${encodeURIComponent(path)}`)
  }

  const memberships = await listMemberships(ctx)
  // Organizations that require 2FA send members without a factor to the security page first.
  if (aal?.nextLevel !== 'aal2' && memberships.some((membership) => membership.organization.require_2fa) && !path.startsWith('/settings/security')) {
    redirect('/settings/security?required=1')
  }

  const [projectsResult, incidentsResult, monitorsResult, profileResult] = await Promise.all([
    ctx.db.from('projects').select('id, name, slug, organization_id, custom_domain, custom_domain_status, organization:organizations(slug)').order('created_at'),
    ctx.db.from('incidents').select('project_id').in('status', [...ACTIVE_INCIDENT_STATUSES]).is('deleted_at', null),
    ctx.db.from('monitors').select('project_id').in('state', ['down', 'degraded']),
    ctx.db.from('profiles').select('name, username').eq('id', ctx.actor.id).maybeSingle(),
  ])

  const appUrl = env.appUrl()
  const projects: ShellProject[] = ((projectsResult.data ?? []) as unknown as Array<{ id: string; name: string; slug: string; organization_id: string; custom_domain: string | null; custom_domain_status: string; organization: { slug: string } | null }>).map((project) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
    organization_id: project.organization_id,
    status_page_url: statusPageUrl(
      { organization_slug: project.organization?.slug ?? '', slug: project.slug, custom_domain: project.custom_domain_status === 'verified' ? project.custom_domain : null },
      { appUrl },
    ),
  }))

  const counts: ShellCounts = { incidents: {}, monitors: {} }
  for (const row of (incidentsResult.data ?? []) as Array<{ project_id: string }>) counts.incidents[row.project_id] = (counts.incidents[row.project_id] ?? 0) + 1
  for (const row of (monitorsResult.data ?? []) as Array<{ project_id: string }>) counts.monitors[row.project_id] = (counts.monitors[row.project_id] ?? 0) + 1

  const organizations: ShellOrganization[] = memberships.map(({ organization, role }) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    plan: organization.plan,
    personal: organization.personal,
    role,
  }))

  const profile = profileResult.data as { name: string | null; username: string | null } | null
  const lastProjectId = (await cookies()).get('upv_project')?.value ?? null

  return (
    <PanelShell
      user={{ id: ctx.actor.id, name: profile?.name || profile?.username || ctx.actor.email || 'You', email: ctx.actor.email }}
      organizations={organizations}
      projects={projects}
      counts={counts}
      lastProjectId={projects.some((project) => project.id === lastProjectId) ? lastProjectId : null}
    >
      {children}
    </PanelShell>
  )
}
