'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { hasRole, ORG_ROLE_LABELS } from '@shared/domain.ts'
import { PLAN_INFO, planAllows } from '@shared/plans.ts'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { CodeBlock } from '@/components/ui/Code'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Field, Input, Switch } from '@/components/ui/Field'
import { PlusIcon } from '@/components/ui/icons'
import { Chip } from '@/components/ui/Status'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { OrganizationResource } from '@/lib/domain/schemas/organizations'
import { forgetOrganization, rememberOrganization } from './org-cookie'

interface Props {
  organization: OrganizationResource
  organizations: OrganizationResource[]
  ownerCount: number
  membersWithout2fa: number
  appHost: string
  openNew: boolean
}

export function OrganizationManager({ organization, organizations, ownerCount, membersWithout2fa, appHost, openNew }: Props) {
  const [creating, setCreating] = useState(openNew)
  const isAdmin = hasRole(organization.role, 'admin')
  const isOwner = organization.role === 'owner'

  return (
    <div className="settings-grid">
      {organization.personal ? (
        <Banner tone="info">
          This is your personal workspace. It comes with your account, its URL follows your username and it cannot be deleted or left. To share status pages
          with your team under a company name, create an organization.
        </Banner>
      ) : null}

      <GeneralCard organization={organization} canEdit={isAdmin} appHost={appHost} />
      <SecurityCard organization={organization} canEdit={isOwner} membersWithout2fa={membersWithout2fa} />

      <Card>
        <CardHeader
          title="Your organizations"
          description="Switch between them with the menu at the top of Settings. Status pages, monitors and API keys belong to one organization."
          actions={
            <Button size="sm" variant="ghost" icon={<PlusIcon size={14} />} onClick={() => setCreating(true)}>
              Create organization
            </Button>
          }
        />
        <div className="tbl" role="table" aria-label="Your organizations" style={{ ['--cols' as string]: 'minmax(0, 1.6fr) minmax(90px, 0.6fr) minmax(90px, 0.6fr)' }}>
          <div className="tr th" role="row">
            <span role="columnheader">Organization</span>
            <span role="columnheader">Plan</span>
            <span role="columnheader">Your role</span>
          </div>
          {organizations.map((org) => (
            <div className="tr" role="row" key={org.id}>
              <span role="cell" className="stack" style={{ ['--gap' as string]: '2px' }}>
                <span className="row" style={{ ['--gap' as string]: '8px' }}>
                  <strong className="truncate" style={{ fontWeight: 550 }}>
                    {org.name}
                  </strong>
                  {org.id === organization.id ? <Chip tone="accent">Selected</Chip> : null}
                </span>
                <span className="mono faint" style={{ fontSize: 12 }}>
                  {org.personal ? 'Personal workspace' : org.slug}
                </span>
              </span>
              <span role="cell">{PLAN_INFO[org.plan].name}</span>
              <span role="cell">{ORG_ROLE_LABELS[org.role]}</span>
            </div>
          ))}
        </div>
      </Card>

      {!organization.personal ? <DangerZone organization={organization} isOwner={isOwner} ownerCount={ownerCount} /> : null}
      {creating ? <CreateOrganizationDialog appHost={appHost} onClose={() => setCreating(false)} /> : null}
    </div>
  )
}

function GeneralCard({ organization, canEdit, appHost }: { organization: OrganizationResource; canEdit: boolean; appHost: string }) {
  const [name, setName] = useState(organization.name)
  const [slug, setSlug] = useState(organization.slug)
  const { run, pending, fieldErrors } = useAction()
  const confirm = useConfirm()
  const slugChanged = slug.trim().toLowerCase() !== organization.slug.toLowerCase()
  const dirty = name.trim() !== organization.name || slugChanged

  const save = async () => {
    if (slugChanged) {
      const ok = await confirm({
        title: 'Change the organization URL?',
        description: `Public status pages move from /status/${organization.slug}/… to /status/${slug.trim().toLowerCase()}/…. Old links stop working; custom domains keep working.`,
        confirmLabel: 'Change URL',
        tone: 'primary',
      })
      if (!ok) return
    }
    const body: Record<string, string> = {}
    if (name.trim() !== organization.name) body.name = name
    if (slugChanged) body.slug = slug
    await run(() => appRequest(`/organizations/${organization.id}`, { method: 'PATCH', body }), { success: 'Organization saved' })
  }

  return (
    <Card>
      <CardHeader title="General" description={canEdit ? 'Name and URL of the organization.' : 'Only admins and owners can change these.'} />
      <form
        className="card-b stack"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="grid-2" style={{ ['--gap' as string]: '16px' }}>
          <Field label="Name" error={fieldErrors.name}>
            {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={!canEdit} required />}
          </Field>
          <Field
            label="URL"
            error={fieldErrors.slug}
            hint={organization.personal ? 'Personal workspaces follow your username.' : 'Used in public status page links. Lowercase letters, numbers and hyphens.'}
          >
            {(props) => (
              <span className="input-group">
                <span className="input-addon">{appHost}/status/</span>
                <input
                  {...props}
                  className="input mono"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value.toLowerCase())}
                  maxLength={63}
                  disabled={!canEdit || organization.personal}
                  required
                />
              </span>
            )}
          </Field>
        </div>
        {canEdit ? (
          <div className="settings-actions">
            <Button type="submit" variant={dirty ? 'primary' : 'ghost'} loading={pending} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  )
}

function SecurityCard({ organization, canEdit, membersWithout2fa }: { organization: OrganizationResource; canEdit: boolean; membersWithout2fa: number }) {
  const [require2fa, setRequire2fa] = useState(organization.require_2fa)
  const [ssoDomain, setSsoDomain] = useState(organization.sso_domain ?? '')
  const { run, pending, fieldErrors } = useAction()
  const ssoAllowed = planAllows(organization.plan, 'sso')
  const ssoChanged = ssoDomain.trim().toLowerCase() !== (organization.sso_domain ?? '')
  const dirty = require2fa !== organization.require_2fa || ssoChanged

  return (
    <Card>
      <CardHeader
        title="Security"
        description={canEdit ? 'Rules that apply to every member of this organization.' : 'Only owners can change security settings.'}
      />
      <form
        className="card-b stack"
        style={{ ['--gap' as string]: '18px' }}
        onSubmit={(event) => {
          event.preventDefault()
          const body: Record<string, unknown> = {}
          if (require2fa !== organization.require_2fa) body.require_2fa = require2fa
          if (ssoChanged) body.sso_domain = ssoDomain.trim() || null
          void run(() => appRequest(`/organizations/${organization.id}`, { method: 'PATCH', body }), { success: 'Security settings saved' })
        }}
      >
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <Switch label="Require two-factor authentication" checked={require2fa} onChange={setRequire2fa} disabled={!canEdit} />
          <span className="help">
            Members without an authenticator app are sent to Settings → Security until they add one.
            {membersWithout2fa > 0 ? ` ${membersWithout2fa} ${membersWithout2fa === 1 ? 'member has' : 'members have'} not set it up yet.` : ''}
            {' '}Turn it on for your own account first.
          </span>
        </div>

        <div className="stack" style={{ ['--gap' as string]: '10px' }}>
          <Field
            label="Single sign-on domain"
            optional
            error={fieldErrors.sso_domain}
            hint={ssoAllowed ? 'People with this email domain can use “Sign in with SSO” on the sign-in page.' : undefined}
          >
            {(props) => (
              <Input {...props} className="mono" value={ssoDomain} onChange={(event) => setSsoDomain(event.target.value)} placeholder="acme.com" disabled={!canEdit || !ssoAllowed} />
            )}
          </Field>
          {ssoAllowed ? (
            <details className="settings-details">
              <summary>How to connect your identity provider</summary>
              <p className="help">
                Upvane signs people in through Supabase Auth SSO (SAML 2.0). Whoever runs Upvane registers your identity provider once, with your domain, then you
                save the same domain here:
              </p>
              <CodeBlock language="bash" code={`supabase sso add --type saml \\\n  --metadata-url https://idp.example.com/saml/metadata \\\n  --domains ${ssoDomain.trim() || 'acme.com'}`} />
              <p className="help">In the identity provider, use the ACS URL and entity ID that `supabase sso info` prints for your project.</p>
            </details>
          ) : (
            <span className="help">
              Single sign-on is part of the Business plan.{' '}
              <Link className="link" href="/settings/billing">
                See plans
              </Link>
            </span>
          )}
        </div>
        {canEdit ? (
          <div className="settings-actions">
            <Button type="submit" variant={dirty ? 'primary' : 'ghost'} loading={pending} disabled={!dirty}>
              Save security settings
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  )
}

function DangerZone({ organization, isOwner, ownerCount }: { organization: OrganizationResource; isOwner: boolean; ownerCount: number }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { run, pending } = useAction()
  const onlyOwner = isOwner && ownerCount <= 1

  const leave = async () => {
    const ok = await confirm({
      title: `Leave ${organization.name}?`,
      description: 'You lose access to its status pages, monitors and incidents. An admin can invite you again.',
      confirmLabel: 'Leave organization',
    })
    if (!ok) return
    const done = await run(() => appRequest(`/organizations/${organization.id}/leave`, { method: 'POST' }).then(() => true), { success: `You left ${organization.name}`, refresh: false })
    if (done) {
      forgetOrganization()
      router.refresh()
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${organization.name}?`,
      description: 'Its status pages go offline and every component, incident, monitor, API key and audit log entry is deleted. This cannot be undone.',
      confirmLabel: 'Delete organization',
      requireText: organization.slug,
    })
    if (!ok) return
    const done = await run(() => appRequest(`/organizations/${organization.id}`, { method: 'DELETE', body: { confirm: organization.slug } }).then(() => true), {
      success: `${organization.name} deleted`,
      refresh: false,
    })
    if (done) {
      forgetOrganization()
      router.refresh()
    }
  }

  return (
    <Card className="danger-zone">
      <CardHeader title="Danger zone" />
      <div className="danger-row">
        <div className="stack" style={{ ['--gap' as string]: '2px' }}>
          <strong>Leave organization</strong>
          <span className="help">{onlyOwner ? 'You are the only owner. Make someone else an owner first, or delete the organization.' : 'You lose access right away.'}</span>
        </div>
        <Button variant="danger-ghost" size="sm" onClick={leave} disabled={onlyOwner || pending}>
          Leave organization
        </Button>
      </div>
      {isOwner ? (
        <div className="danger-row">
          <div className="stack" style={{ ['--gap' as string]: '2px' }}>
            <strong>Delete organization</strong>
            <span className="help">Deletes its status pages and everything in them. Members keep their accounts.</span>
          </div>
          <Button variant="danger-ghost" size="sm" onClick={remove} disabled={pending}>
            Delete organization
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

function CreateOrganizationDialog({ appHost, onClose }: { appHost: string; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const { run, pending, fieldErrors } = useAction()

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create organization"
      description="A shared home for your team's status pages, monitors and API keys. It starts on the Free plan and you are its owner."
      onSubmit={async () => {
        const created = await run(() => appRequest<OrganizationResource>('/organizations', { body: { name, slug: slug.trim() || null } }), { success: 'Organization created', refresh: false })
        if (created) {
          rememberOrganization(created.id)
          onClose()
          router.replace('/settings/organization')
          router.refresh()
        }
      }}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            Create organization
          </Button>
        </>
      }
    >
      <Field label="Name" error={fieldErrors.name}>
        {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme" maxLength={80} autoFocus required />}
      </Field>
      <Field label="URL" optional error={fieldErrors.slug} hint="Generated from the name when empty.">
        {(props) => (
          <span className="input-group">
            <span className="input-addon">{appHost}/status/</span>
            <input {...props} className="input mono" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} placeholder="acme" maxLength={63} />
          </span>
        )}
      </Field>
    </Dialog>
  )
}
