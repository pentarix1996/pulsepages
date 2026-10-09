import type { Metadata } from 'next'
import { hasRole } from '@shared/domain.ts'
import { planLimit } from '@shared/plans.ts'
import { suggestedRegions } from '@shared/regions.ts'
import { PageHeader } from '@/components/panel/PageHeader'
import { IntegrationsManager, type AsCodeSnippet } from '@/components/panel/integrations/IntegrationsManager'
import { Card, EmptyState } from '@/components/ui/Card'
import { env } from '@/lib/env'
import { DATADOG_PAYLOAD_TEMPLATE } from '@/lib/domain/inbound/datadog'
import { listIntegrations } from '@/lib/domain/integrations'
import { listAllMonitors } from '@/lib/domain/monitors'
import { guard, panelContext, projectAccess } from '@/lib/panel/server'
import '@/styles/panel/monitors.css'

export const metadata: Metadata = { title: 'Integrations' }

function snippetsFor(options: { slug: string; apiUrl: string; component: string; componentName: string; interval: number; regions: string[] }): AsCodeSnippet[] {
  const { slug, apiUrl, component, componentName, interval, regions } = options
  return [
    {
      id: 'terraform',
      label: 'Terraform',
      language: 'hcl',
      source: `terraform {
  required_providers {
    upvane = { source = "upvane/upvane" }
  }
}

# Reads UPVANE_API_KEY from the environment
provider "upvane" {
  base_url = "${apiUrl}"
}

resource "upvane_component" "api" {
  project = "${slug}"
  name    = "${componentName}"
  slug    = "${component}"
}

resource "upvane_monitor" "api_health" {
  project          = "${slug}"
  name             = "${componentName} health"
  type             = "http"
  interval_seconds = ${interval}
  regions          = [${regions.map((region) => `"${region}"`).join(', ')}]
  confirm_regions  = ${Math.min(2, regions.length)}
  components       = [upvane_component.api.id]

  http {
    url = "https://api.example.com/health"
  }
}`,
    },
    {
      id: 'cli',
      label: 'CLI',
      language: 'shell',
      source: `export UPVANE_API_KEY=upv_live_…
export UPVANE_API_URL=${apiUrl}
export UPVANE_PROJECT=${slug}

# Declare an incident from a runbook
npx @upvane/cli incidents create \\
  --title "Elevated API errors" \\
  --impact minor \\
  --component ${component}=degraded \\
  --message "We are looking into failed requests."

# Wrap a cron job: pings on success, reports the exit code on failure
npx @upvane/cli heartbeat <token> -- ./nightly-backup.sh`,
    },
    {
      id: 'github-action',
      label: 'GitHub Action',
      language: 'yaml',
      source: `# .github/workflows/deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Opens a maintenance window now and completes it when the job ends
      - uses: upvane/maintenance-action@v1
        with:
          api-key: \${{ secrets.UPVANE_API_KEY }}
          api-url: ${apiUrl}
          project: ${slug}
          title: Deploy \${{ github.ref_name }}
          components: ${component}
          duration-minutes: 15

      - run: ./scripts/deploy.sh`,
    },
    {
      id: 'curl',
      label: 'curl',
      language: 'shell',
      source: `curl ${apiUrl}/projects/${slug}/incidents \\
  -H "Authorization: Bearer $UPVANE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: api-errors-$(date +%s)" \\
  -d '{
    "title": "Elevated API errors",
    "status": "investigating",
    "impact": "minor",
    "components": { "${component}": "degraded" },
    "message": "We are looking into failed requests."
  }'`,
    },
  ]
}

export default async function IntegrationsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const access = await projectAccess(projectId)
  const header = <PageHeader title="Integrations" subtitle="Bring alerts from the tools you already run, ping heartbeats from your jobs and manage everything as code." />

  if (!hasRole(access.role, 'admin')) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title="Admins manage integrations" description="Integration and heartbeat URLs carry secret tokens, so only admins and owners can see them. Ask an admin of your organization for access." center />
        </Card>
      </>
    )
  }

  const ctx = await panelContext()
  const [{ integrations }, { monitors }, components] = await Promise.all([
    guard(() => listIntegrations(ctx, access.project.id)),
    guard(() => listAllMonitors(ctx, access.project.id, { type: ['heartbeat'] })),
    ctx.db.from('components').select('id, name, slug').eq('project_id', access.project.id).order('position').order('name'),
  ])
  const componentRows = (components.data ?? []) as Array<{ id: string; name: string; slug: string }>
  const plan = access.organization.plan
  const regionCount = planLimit(plan, 'regions_per_monitor')

  return (
    <>
      {header}
      <IntegrationsManager
        projectId={access.project.id}
        integrations={integrations}
        components={componentRows}
        heartbeats={monitors.map((monitor) => ({
          id: monitor.id,
          name: monitor.name,
          state: monitor.state,
          enabled: monitor.enabled,
          heartbeat_url: monitor.heartbeat_url,
          last_heartbeat_at: monitor.last_heartbeat_at,
          interval_seconds: monitor.interval_seconds,
        }))}
        snippets={snippetsFor({
          slug: access.project.slug,
          apiUrl: `${env.appUrl()}/api/v1`,
          component: componentRows[0]?.slug ?? 'api',
          componentName: componentRows[0]?.name ?? 'API',
          interval: Math.max(60, planLimit(plan, 'min_interval_seconds')),
          regions: suggestedRegions(regionCount === -1 ? 3 : Math.min(3, regionCount)),
        })}
        datadogTemplate={DATADOG_PAYLOAD_TEMPLATE}
      />
    </>
  )
}
