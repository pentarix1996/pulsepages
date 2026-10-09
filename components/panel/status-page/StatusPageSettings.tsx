'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { CopyButton, SecretValue } from '@/components/ui/Code'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Chip } from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import { RelativeTime } from '@/components/ui/Time'
import { ExternalLinkIcon, LockIcon, PlusIcon, RefreshIcon, TrashIcon, UploadIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { AccessTokenCreated, AccessTokenResource, CustomDomainState, LogoUploadResult, ProjectSettingsResource } from '@/lib/domain/schemas/status-page'
import { parseAllowList } from '@/lib/domain/schemas/status-page'
import { formatDate } from '@/lib/format'

interface Props {
  project: ProjectSettingsResource
  domain: CustomDomainState
  tokens: AccessTokenResource[]
  pathPrefix: string
  canEdit: boolean
  gates: { branding: boolean; customDomain: boolean; privatePages: boolean }
  planName: string
}

const THEME_OPTIONS = [
  { value: 'system', label: 'Follow the visitor' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const WEIGHT_OPTIONS = [
  { value: '1', label: 'Counts as downtime' },
  { value: '0.5', label: 'Counts as half' },
  { value: '0.3', label: 'Counts as 30%' },
  { value: '0', label: 'Does not count' },
]

function timeZones(current: string): string[] {
  let zones: string[] = []
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    zones = []
  }
  if (!zones.includes('UTC')) zones = ['UTC', ...zones]
  if (current && !zones.includes(current)) zones = [current, ...zones]
  return zones
}

export function StatusPageSettings({ project, domain, tokens, pathPrefix, canEdit, gates, planName }: Props) {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const { run, pending, fieldErrors } = useAction()

  // ------------------------------------------------------------ general + appearance form
  const [form, setForm] = useState({
    name: project.name,
    slug: project.slug,
    description: project.description ?? '',
    support_url: project.support_url ?? '',
    timezone: project.timezone,
    theme_default: project.theme_default,
    brand_color: project.brand_color ?? '',
    logo_url: project.logo_url ?? '',
    hide_powered_by: project.hide_powered_by,
    auto_postmortem: project.auto_postmortem,
    auto_draft_incidents: project.auto_draft_incidents,
    weight_partial: String(project.uptime_weights.partial_outage),
    weight_degraded: String(project.uptime_weights.degraded),
  })
  const [uploading, setUploading] = useState(false)
  const zones = useMemo(() => timeZones(project.timezone), [project.timezone])
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }))

  const saveGeneral = async () => {
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      support_url: form.support_url.trim() || null,
      timezone: form.timezone,
      theme_default: form.theme_default,
      auto_postmortem: form.auto_postmortem,
      auto_draft_incidents: form.auto_draft_incidents,
      uptime_weights: { major_outage: 1, partial_outage: Number(form.weight_partial), degraded: Number(form.weight_degraded) },
    }
    if (form.slug.trim() !== project.slug) body.slug = form.slug.trim()
    if (gates.branding) {
      body.brand_color = form.brand_color.trim() || null
      body.logo_url = form.logo_url.trim() || null
      body.hide_powered_by = form.hide_powered_by
    }
    if (body.slug) {
      const ok = await confirm({
        title: 'Change the public URL?',
        description: `The page moves to ${pathPrefix}${String(body.slug)}. Links to the old address stop working.`,
        confirmLabel: 'Change URL',
        tone: 'primary',
      })
      if (!ok) return
    }
    await run(() => appRequest(`/projects/${project.id}`, { method: 'PATCH', body }), { success: 'Settings saved', successDescription: 'The status page shows the changes within 30 seconds.' })
  }

  const uploadLogo = async (file: File) => {
    setUploading(true)
    try {
      const data = new FormData()
      data.set('file', file)
      const response = await fetch(`/api/app/projects/${project.id}/logo`, { method: 'POST', body: data, credentials: 'same-origin' })
      const payload = (await response.json().catch(() => ({}))) as { data?: LogoUploadResult; error?: string }
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'The logo could not be uploaded.')
      set('logo_url', payload.data.url)
      toast.success('Logo uploaded', 'Save changes to show it on the status page.')
    } catch (error) {
      toast.error('Logo not uploaded', error instanceof Error ? error.message : undefined)
    } finally {
      setUploading(false)
    }
  }

  // ------------------------------------------------------------ visibility
  const [visibility, setVisibility] = useState(project.visibility)
  const [allowList, setAllowList] = useState(project.allowed_ips.join('\n'))
  const parsedAllowList = useMemo(() => parseAllowList(allowList), [allowList])

  const saveVisibility = async () => {
    if (parsedAllowList.errors.length > 0) {
      toast.error('Fix the IP allow-list', `Line ${parsedAllowList.errors[0]!.line}: ${parsedAllowList.errors[0]!.value} is not an IP address or CIDR range.`)
      return
    }
    await run(() => appRequest(`/projects/${project.id}`, { method: 'PATCH', body: { visibility, allowed_ips: parsedAllowList.values } }), {
      success: visibility === 'private' ? 'Page is private' : 'Page is public',
      successDescription: visibility === 'private' ? 'Visitors need an access link, a matching IP address or an Upvane account in your organization.' : undefined,
    })
  }

  // ------------------------------------------------------------ access links
  const [linkDialog, setLinkDialog] = useState(false)
  const [linkName, setLinkName] = useState('')
  const [linkExpiry, setLinkExpiry] = useState('')
  const [created, setCreated] = useState<AccessTokenCreated | null>(null)

  const createLink = async () => {
    const result = await run(
      () => appRequest<AccessTokenCreated>(`/projects/${project.id}/access-tokens`, { body: { name: linkName.trim(), expires_at: linkExpiry ? new Date(`${linkExpiry}T23:59:59`).toISOString() : null } }),
      { success: 'Access link created' },
    )
    if (result) {
      setCreated(result)
      setLinkName('')
      setLinkExpiry('')
    }
  }

  const revokeLink = async (token: AccessTokenResource) => {
    const ok = await confirm({ title: `Revoke the link for ${token.name}?`, description: 'Anyone using it loses access right away. This cannot be undone.', confirmLabel: 'Revoke link' })
    if (ok) await run(() => appRequest(`/projects/${project.id}/access-tokens/${token.id}`, { method: 'DELETE' }), { success: 'Link revoked' })
  }

  // ------------------------------------------------------------ custom domain
  const [domainInput, setDomainInput] = useState(domain.domain ?? '')
  const [domainState, setDomainState] = useState(domain)

  const saveDomain = async (value: string | null) => {
    if (value === null) {
      const ok = await confirm({ title: `Remove ${domainState.domain}?`, description: `The page goes back to ${project.status_page_url.startsWith(pathPrefix) ? project.status_page_url : `${pathPrefix}${project.slug}`}. Remove the CNAME record afterwards.`, confirmLabel: 'Remove domain' })
      if (!ok) return
    }
    const result = await run(() => appRequest<CustomDomainState>(`/projects/${project.id}/custom-domain`, value === null ? { method: 'DELETE' } : { method: 'PUT', body: { domain: value } }), {
      success: value === null ? 'Custom domain removed' : 'Domain saved',
      successDescription: value === null ? undefined : 'Add the DNS record below, then check it.',
    })
    if (result) {
      setDomainState(result)
      if (value === null) setDomainInput('')
    }
  }

  const verifyDomain = async () => {
    const state = await run(() => appRequest<CustomDomainState>(`/projects/${project.id}/custom-domain/verify`, { method: 'POST' }))
    if (!state) return
    setDomainState(state)
    if (state.status === 'verified') toast.success('Domain verified', `${state.domain} serves your status page.`)
    else toast.info('Not verified yet', state.error ?? 'DNS changes can take a few minutes to reach every resolver.')
  }

  const pageUrl = project.status_page_url

  return (
    <>
      <Card>
        <div className="sp-hero">
          <div className="stack" style={{ ['--gap' as string]: '6px', minWidth: 0 }}>
            <span className="help">Your status page</span>
            <a className="sp-url mono" href={pageUrl} target="_blank" rel="noreferrer">
              {pageUrl.replace(/^https?:\/\//, '')}
            </a>
            <span className="row" style={{ ['--gap' as string]: '8px' }}>
              <Chip tone={project.visibility === 'private' ? 'accent' : 'success'}>
                {project.visibility === 'private' ? (
                  <>
                    <LockIcon size={12} /> Private
                  </>
                ) : (
                  'Public'
                )}
              </Chip>
              {project.custom_domain && project.custom_domain_status === 'verified' ? <Chip tone="success">Custom domain</Chip> : null}
            </span>
          </div>
          <div className="row" style={{ ['--gap' as string]: '8px' }}>
            <CopyButton value={pageUrl} label="Copy URL" />
            <ButtonLink href={pageUrl} target="_blank" rel="noreferrer" icon={<ExternalLinkIcon size={14} />}>
              Open
            </ButtonLink>
          </div>
        </div>
      </Card>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void saveGeneral()
        }}
        className="stack"
      >
        <Card>
          <CardHeader title="Page" description="What visitors see at the top of the page and in emails." />
          <div className="card-b stack">
            <div className="mf-grid">
              <Field label="Name" error={fieldErrors.name}>
                {(props) => <Input {...props} value={form.name} maxLength={80} onChange={(event) => set('name', event.target.value)} disabled={!canEdit} />}
              </Field>
              <Field label="Address" hint="Lowercase letters, numbers and dashes." error={fieldErrors.slug}>
                {(props) => (
                  <div className="input-group">
                    <span className="input-addon mono" title={pathPrefix}>
                      …/{pathPrefix.split('/').filter(Boolean).pop()}/
                    </span>
                    <Input {...props} className="mono" value={form.slug} maxLength={60} onChange={(event) => set('slug', event.target.value.toLowerCase())} disabled={!canEdit} />
                  </div>
                )}
              </Field>
            </div>
            <Field label="Description" optional hint="One or two sentences under the name." error={fieldErrors.description}>
              {(props) => <Textarea {...props} rows={2} value={form.description} maxLength={500} onChange={(event) => set('description', event.target.value)} disabled={!canEdit} />}
            </Field>
            <div className="mf-grid">
              <Field label="Support link" optional hint="Where the page sends people who need help." error={fieldErrors.support_url}>
                {(props) => <Input {...props} type="url" value={form.support_url} onChange={(event) => set('support_url', event.target.value)} placeholder="https://example.com/support" disabled={!canEdit} />}
              </Field>
              <Field label="Time zone" hint="Used for times on the page and in maintenance emails." error={fieldErrors.timezone}>
                {(props) => <Select {...props} value={form.timezone} onChange={(event) => set('timezone', event.target.value)} options={zones.map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }))} disabled={!canEdit} />}
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Appearance" description={gates.branding ? 'Your logo and color on the page, emails and embeds.' : `Logo, brand color and removing the Upvane footer need the Pro plan. You are on ${planName}.`} />
          <div className="card-b stack">
            <Field label="Default theme" hint="Visitors can still switch.">
              {(props) => (
                <div id={props.id}>
                  <Segmented<string> label="Default theme" value={form.theme_default} onChange={(value) => set('theme_default', value as typeof form.theme_default)} options={THEME_OPTIONS} />
                </div>
              )}
            </Field>
            <div className="mf-grid">
              <Field label="Brand color" optional hint="Links and buttons on the page. Hex, such as #5B58E8." error={fieldErrors.brand_color}>
                {(props) => (
                  <div className="row" style={{ ['--gap' as string]: '8px' }}>
                    <input type="color" aria-label="Pick a brand color" value={/^#[0-9a-f]{6}$/i.test(form.brand_color) ? form.brand_color : '#5B58E8'} onChange={(event) => set('brand_color', event.target.value.toUpperCase())} disabled={!canEdit || !gates.branding} className="sp-color" />
                    <Input {...props} className="mono" value={form.brand_color} onChange={(event) => set('brand_color', event.target.value)} placeholder="#5B58E8" disabled={!canEdit || !gates.branding} maxLength={7} />
                  </div>
                )}
              </Field>
              <Field label="Logo" optional hint="PNG, JPEG, WebP or SVG, up to 1 MB. Wide logos work best." error={fieldErrors.logo_url}>
                {(props) => (
                  <div className="row" style={{ ['--gap' as string]: '10px' }} id={props.id}>
                    {form.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- user logo from storage
                      <img src={form.logo_url} alt="Current logo" className="sp-logo" />
                    ) : (
                      <span className="sp-logo sp-logo-empty">No logo</span>
                    )}
                    <label className={['btn btn-ghost btn-sm', !canEdit || !gates.branding ? 'is-disabled' : ''].join(' ')} aria-disabled={!canEdit || !gates.branding}>
                      <UploadIcon size={14} />
                      {uploading ? 'Uploading…' : 'Upload'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="sr-only"
                        disabled={!canEdit || !gates.branding || uploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) void uploadLogo(file)
                          event.target.value = ''
                        }}
                      />
                    </label>
                    {form.logo_url ? (
                      <Button size="sm" variant="quiet" onClick={() => set('logo_url', '')} disabled={!canEdit}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                )}
              </Field>
            </div>
            <Switch label="Hide “Powered by Upvane” in the footer" checked={form.hide_powered_by} onChange={(checked) => set('hide_powered_by', checked)} disabled={!canEdit || !gates.branding} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Incidents and uptime" description="How incidents start and how outages count against uptime on the page." />
          <div className="card-b stack">
            <div className="mf-toggles">
              <Switch label="Let monitors open draft incidents when they go down" checked={form.auto_draft_incidents} onChange={(checked) => set('auto_draft_incidents', checked)} disabled={!canEdit} />
              <Switch label="Draft a postmortem when a major or critical incident is resolved" checked={form.auto_postmortem} onChange={(checked) => set('auto_postmortem', checked)} disabled={!canEdit} />
            </div>
            <div className="mf-grid">
              <Field label="Major outage" hint="Always counts as downtime.">
                {(props) => <Input {...props} value="Counts as downtime" disabled />}
              </Field>
              <Field label="Partial outage">
                {(props) => <Select {...props} value={form.weight_partial} onChange={(event) => set('weight_partial', event.target.value)} options={withCurrent(WEIGHT_OPTIONS, form.weight_partial)} disabled={!canEdit} />}
              </Field>
              <Field label="Degraded performance">
                {(props) => <Select {...props} value={form.weight_degraded} onChange={(event) => set('weight_degraded', event.target.value)} options={withCurrent(WEIGHT_OPTIONS, form.weight_degraded)} disabled={!canEdit} />}
              </Field>
            </div>
          </div>
        </Card>

        {canEdit ? (
          <div className="mf-actions">
            <Button type="submit" variant="primary" loading={pending}>
              Save changes
            </Button>
          </div>
        ) : null}
      </form>

      <Card>
        <CardHeader title="Who can see it" description={gates.privatePages ? 'Private pages answer 404 to everyone without access.' : `Private pages need the Business plan. You are on ${planName}.`} />
        <div className="card-b stack">
<div>
          <Segmented<'public' | 'private'>
            label="Visibility"
            value={visibility}
            onChange={(value) => setVisibility(value)}
            options={[
              { value: 'public', label: 'Public' },
              { value: 'private', label: 'Private' },
            ]}
          />
          </div>
          {visibility === 'private' ? (
            <>
              <p className="help">Members of your organization always get in. Others need an access link or an address from the allow-list.</p>
              <Field label="IP allow-list" optional hint="One address or CIDR range per line, such as 203.0.113.0/24. Lines starting with # are comments.">
                {(props) => <Textarea {...props} className="mono" rows={4} value={allowList} onChange={(event) => setAllowList(event.target.value)} disabled={!canEdit || !gates.privatePages} placeholder={'# Office VPN\n203.0.113.0/24'} />}
              </Field>
              {parsedAllowList.errors.length > 0 ? (
                <p className="field-error">
                  {parsedAllowList.errors
                    .slice(0, 3)
                    .map((error) => `Line ${error.line}: ${error.value}`)
                    .join('; ')}{' '}
                  {parsedAllowList.errors.length === 1 ? 'is not' : 'are not'} valid.
                </p>
              ) : null}
            </>
          ) : null}
          {canEdit ? (
            <div>
              <Button variant="primary" onClick={() => void saveVisibility()} loading={pending} disabled={!gates.privatePages && visibility === 'private'}>
                Save visibility
              </Button>
            </div>
          ) : null}
        </div>
        {project.visibility === 'private' || visibility === 'private' ? (
          <>
            <div className="card-h" style={{ borderTop: '1px solid var(--line)' }}>
              <div>
                <h3 className="section-title">Access links</h3>
                <p className="help">Share a link with customers or partners. Revoke it any time.</p>
              </div>
              {canEdit && gates.privatePages ? (
                <Button size="sm" icon={<PlusIcon size={14} />} onClick={() => setLinkDialog(true)}>
                  New link
                </Button>
              ) : null}
            </div>
            {tokens.length === 0 ? (
              <EmptyState title="No access links" description="Create one per customer or team so you can revoke them separately." />
            ) : (
              <div className="tbl-scroll">
                <div className="tbl" role="table" aria-label="Access links" style={{ ['--cols' as string]: 'minmax(180px, 1.4fr) minmax(110px, 0.8fr) minmax(130px, 1fr) minmax(130px, 1fr) 90px', minWidth: 720 }}>
                  <div className="tr th" role="row">
                    <span role="columnheader">Name</span>
                    <span role="columnheader">Status</span>
                    <span role="columnheader">Expires</span>
                    <span role="columnheader">Last used</span>
                    <span role="columnheader">
                      <span className="sr-only">Actions</span>
                    </span>
                  </div>
                  {tokens.map((token) => (
                    <div className="tr" role="row" key={token.id}>
                      <span role="cell" className="stack" style={{ ['--gap' as string]: '2px' }}>
                        <span style={{ fontWeight: 550 }}>{token.name}</span>
                        <span className="mono faint" style={{ fontSize: 12 }}>
                          {token.prefix}…
                        </span>
                      </span>
                      <span role="cell">
                        <Chip tone={token.status === 'active' ? 'success' : 'neutral'}>{token.status === 'active' ? 'Active' : token.status === 'expired' ? 'Expired' : 'Revoked'}</Chip>
                      </span>
                      <span role="cell" style={{ fontSize: 13 }}>
                        {token.expires_at ? formatDate(token.expires_at) : 'Never'}
                      </span>
                      <span role="cell" style={{ fontSize: 13 }}>
                        <RelativeTime value={token.last_used_at} />
                      </span>
                      <span role="cell">
                        {canEdit && token.status === 'active' ? (
                          <Button size="sm" variant="quiet" icon={<TrashIcon size={14} />} onClick={() => void revokeLink(token)}>
                            Revoke
                          </Button>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Custom domain" description={gates.customDomain ? 'Serve the page from your own domain, such as status.example.com. HTTPS is set up for you.' : `Custom domains need the Pro plan. You are on ${planName}.`} />
        <div className="card-b stack">
          <div className="row row-wrap" style={{ ['--gap' as string]: '8px', alignItems: 'flex-end' }}>
            <Field label="Domain" className="grow" error={fieldErrors.domain}>
              {(props) => <Input {...props} className="mono" value={domainInput} onChange={(event) => setDomainInput(event.target.value)} placeholder="status.example.com" disabled={!canEdit || !gates.customDomain} />}
            </Field>
            {canEdit && gates.customDomain ? (
              <div className="row" style={{ ['--gap' as string]: '8px', paddingBottom: fieldErrors.domain ? 22 : 0 }}>
                <Button variant="primary" onClick={() => void saveDomain(domainInput.trim())} disabled={pending || domainInput.trim() === '' || domainInput.trim() === domainState.domain}>
                  Save domain
                </Button>
                {domainState.domain ? (
                  <Button variant="danger-ghost" onClick={() => void saveDomain(null)} disabled={pending}>
                    Remove
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {domainState.domain ? (
            <>
              <div className="row" style={{ ['--gap' as string]: '10px' }}>
                <Chip tone={domainState.status === 'verified' ? 'success' : domainState.status === 'error' || domainState.status === 'suspended' ? 'danger' : 'warning'}>
                  {domainState.status === 'verified' ? 'Verified' : domainState.status === 'pending' ? 'Waiting for DNS' : domainState.status === 'suspended' ? 'Suspended' : 'Not working'}
                </Chip>
                {domainState.verified_at ? (
                  <span className="help">
                    Verified <RelativeTime value={domainState.verified_at} />
                  </span>
                ) : null}
                {canEdit ? (
                  <Button size="sm" icon={<RefreshIcon size={14} />} onClick={() => void verifyDomain()} loading={pending}>
                    Check DNS
                  </Button>
                ) : null}
              </div>
              {domainState.error && domainState.status !== 'verified' ? <Banner tone="warning">{domainState.error}</Banner> : null}
              <div className="tbl-scroll">
                <div className="tbl" role="table" aria-label="DNS records" style={{ ['--cols' as string]: '80px minmax(160px, 1fr) minmax(200px, 1.4fr) 90px', minWidth: 620 }}>
                  <div className="tr th" role="row">
                    <span role="columnheader">Type</span>
                    <span role="columnheader">Name</span>
                    <span role="columnheader">Value</span>
                    <span role="columnheader">
                      <span className="sr-only">Copy</span>
                    </span>
                  </div>
                  {domainState.records.map((record) => (
                    <div className="tr" role="row" key={`${record.type}-${record.name}`}>
                      <span role="cell" className="mono">
                        {record.type}
                      </span>
                      <span role="cell" className="mono truncate" title={record.name}>
                        {record.name}
                      </span>
                      <span role="cell" className="mono truncate" title={record.value}>
                        {record.value}
                      </span>
                      <span role="cell">
                        <CopyButton value={record.value} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {canEdit ? <DeleteStatusPage project={project} /> : null}

      <Dialog
        open={linkDialog}
        onClose={() => {
          setLinkDialog(false)
          setCreated(null)
          router.refresh()
        }}
        title={created ? 'Copy the access link' : 'New access link'}
        description={created ? 'Anyone with this link can see the private page until you revoke it.' : 'Name it after who will use it, so you know which one to revoke.'}
        onSubmit={created ? undefined : () => void createLink()}
        footer={
          created ? (
            <Button
              variant="primary"
              onClick={() => {
                setLinkDialog(false)
                setCreated(null)
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setLinkDialog(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={pending}>
                Create link
              </Button>
            </>
          )
        }
      >
        {created ? (
          <SecretValue value={created.url} />
        ) : (
          <div className="stack">
            <Field label="Who it is for" error={fieldErrors.name}>
              {(props) => <Input {...props} value={linkName} maxLength={80} onChange={(event) => setLinkName(event.target.value)} placeholder="Acme support team" autoFocus />}
            </Field>
            <Field label="Expires" optional hint="Leave empty to keep it until you revoke it." error={fieldErrors.expires_at}>
              {(props) => <Input {...props} type="date" value={linkExpiry} onChange={(event) => setLinkExpiry(event.target.value)} />}
            </Field>
          </div>
        )}
      </Dialog>
    </>
  )
}

/** Deleting a page takes its public URL offline and removes everything in it, so it asks for the page's slug. */
function DeleteStatusPage({ project }: { project: ProjectSettingsResource }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { run, pending } = useAction()

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${project.name}?`,
      description: 'The public page goes offline and its components, incidents, maintenance windows, monitors, alert rules and subscribers are deleted. This cannot be undone.',
      confirmLabel: 'Delete status page',
      requireText: project.slug,
    })
    if (!ok) return
    const done = await run(() => appRequest(`/projects/${project.id}`, { method: 'DELETE' }).then(() => true), { success: `${project.name} deleted`, refresh: false })
    if (done) router.push('/projects')
  }

  return (
    <Card className="danger-zone">
      <CardHeader title="Danger zone" />
      <div className="danger-row">
        <div className="stack" style={{ ['--gap' as string]: '2px' }}>
          <strong>Delete status page</strong>
          <span className="help">Takes {project.name} offline for everyone, including subscribers and API clients.</span>
        </div>
        <Button variant="danger-ghost" size="sm" onClick={remove} disabled={pending}>
          Delete status page
        </Button>
      </div>
    </Card>
  )
}

function withCurrent(options: Array<{ value: string; label: string }>, current: string) {
  return options.some((option) => Number(option.value) === Number(current)) ? options.map((option) => ({ ...option, value: Number(option.value) === Number(current) ? current : option.value })) : [...options, { value: current, label: `Counts as ${Math.round(Number(current) * 100)}%` }]
}

