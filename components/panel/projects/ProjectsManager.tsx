'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { INCIDENT_IMPACT_LABELS } from '@shared/domain.ts'
import { PLAN_INFO } from '@shared/plans.ts'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, EmptyState } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Chip, StatusPill } from '@/components/ui/Status'
import { ExternalLinkIcon, LockIcon, PlusIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { PanelOrganization } from '@/lib/domain/projects'
import type { ProjectResource } from '@/lib/domain/schemas/projects'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function ProjectsManager({ organizations, openNew, joined }: { organizations: PanelOrganization[]; openNew: boolean; joined: string | null }) {
  const router = useRouter()
  const creatable = organizations.filter((organization) => organization.can_create)
  const [open, setOpen] = useState(openNew && creatable.length > 0)
  const [organizationId, setOrganizationId] = useState(creatable[0]?.id ?? '')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const { run, pending, fieldErrors } = useAction()
  const joinedOrg = joined ? organizations.find((organization) => organization.slug === joined) : null
  const total = organizations.reduce((sum, organization) => sum + organization.projects.length, 0)

  const create = async () => {
    const project = await run(() => appRequest<ProjectResource>('/projects', { body: { organization_id: organizationId, name: name.trim(), ...(slug.replace(/^-+|-+$/g, '') ? { slug: slug.replace(/^-+|-+$/g, '') } : {}) } }), {
      success: 'Status page created',
      successDescription: 'Add the components customers depend on, then a monitor for each.',
      refresh: false,
    })
    if (project) router.push(`/p/${project.id}/overview`)
  }

  return (
    <>
      {joinedOrg ? <Banner tone="success">You joined {joinedOrg.name}. Its status pages are below.</Banner> : null}

      {total === 0 ? (
        <Card>
          <EmptyState
            title="Create your first status page"
            description="A status page tells customers what works right now. Upvane keeps it up to date from your monitors, incidents and maintenance."
            action={
              creatable.length > 0 ? (
                <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setOpen(true)}>
                  New status page
                </Button>
              ) : (
                <span className="help">Ask an admin of your organization to create one.</span>
              )
            }
            center
          />
        </Card>
      ) : null}

      {organizations
        .filter((organization) => organization.projects.length > 0 || organization.can_create)
        .map((organization) => (
          <section key={organization.id} className="pj-org" aria-label={organization.name}>
            <div className="pj-org-head">
              <div className="stack" style={{ ['--gap' as string]: '2px' }}>
                <h2 className="section-title">{organization.personal ? 'Personal' : organization.name}</h2>
                <span className="help">
                  {PLAN_INFO[organization.plan].name} plan,{' '}
                  {organization.project_limit === -1 ? `${organization.projects.length} ${organization.projects.length === 1 ? 'status page' : 'status pages'}` : `${organization.projects.length} of ${organization.project_limit} status ${organization.project_limit === 1 ? 'page' : 'pages'}`}
                </span>
              </div>
              {organization.can_create ? (
                <Button
                  size="sm"
                  icon={<PlusIcon size={14} />}
                  onClick={() => {
                    setOrganizationId(organization.id)
                    setOpen(true)
                  }}
                >
                  New status page
                </Button>
              ) : organization.role === 'admin' || organization.role === 'owner' ? (
                <ButtonLink size="sm" href="/settings/billing">
                  Upgrade for more pages
                </ButtonLink>
              ) : null}
            </div>
            {organization.projects.length === 0 ? <p className="help">No status pages here yet.</p> : null}
            <div className="pj-grid">
              {organization.projects.map((project) => (
                <Link key={project.id} href={`/p/${project.id}/overview`} className={['pj-card', project.open_incidents > 0 ? 'has-incident' : ''].join(' ')}>
                  <span className="pj-card-top">
                    <strong>{project.name}</strong>
                    {project.visibility === 'private' ? (
                      <Chip tone="accent">
                        <LockIcon size={11} /> Private
                      </Chip>
                    ) : null}
                  </span>
                  <StatusPill status={project.status} />
                  <span className="pj-card-meta">
                    {project.open_incidents > 0 ? (
                      <span className="s-major">
                        {project.open_incidents} open {project.open_incidents === 1 ? 'incident' : 'incidents'}
                        {project.worst_impact ? `, ${INCIDENT_IMPACT_LABELS[project.worst_impact].toLowerCase()} impact` : ''}
                      </span>
                    ) : (
                      <span>No open incidents</span>
                    )}
                    <span>
                      {project.components} {project.components === 1 ? 'component' : 'components'}
                    </span>
                  </span>
                  <span className="pj-card-url mono">
                    {project.status_page_url.replace(/^https?:\/\//, '')}
                    <ExternalLinkIcon size={12} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New status page"
        description="One page per product or audience. You can change the name and address later."
        onSubmit={() => void create()}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>
              Create status page
            </Button>
          </>
        }
      >
        <div className="stack">
          {creatable.length > 1 ? (
            <Field label="Organization">
              {(props) => <Select {...props} value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} options={creatable.map((organization) => ({ value: organization.id, label: organization.personal ? 'Personal' : organization.name }))} />}
            </Field>
          ) : null}
          <Field label="Name" hint="Usually your product name, such as Quillbase." error={fieldErrors.name}>
            {(props) => (
              <Input
                {...props}
                value={name}
                maxLength={80}
                autoFocus
                onChange={(event) => {
                  setName(event.target.value)
                  if (!slugTouched) setSlug(slugify(event.target.value))
                }}
                placeholder="Quillbase"
              />
            )}
          </Field>
          <Field label="Address" hint={`/status/${organizations.find((organization) => organization.id === organizationId)?.slug ?? ''}/${slug || 'your-page'}`} error={fieldErrors.slug}>
            {(props) => (
              <Input
                {...props}
                className="mono"
                value={slug}
                maxLength={48}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 48))
                }}
                placeholder="quillbase"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </>
  )
}
