'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { hasRole, ORG_ROLE_HINTS, ORG_ROLE_LABELS, ORG_ROLES, type OrgRole } from '@shared/domain.ts'
import { PLAN_INFO, PLANS, planLimit } from '@shared/plans.ts'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/Code'
import { Dialog, useConfirm } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Avatar } from '@/components/ui/Misc'
import { LogOutIcon, MailIcon, MoreIcon, PlusIcon, RefreshIcon, TrashIcon, XIcon } from '@/components/ui/icons'
import { Chip } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import { useToast } from '@/components/ui/Toast'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import {
  assignableRoles,
  canManageMember,
  memberDisplayName,
  type InvitationDelivery,
  type InvitationResource,
  type MemberResource,
  type OrganizationResource,
} from '@/lib/domain/schemas/organizations'
import { formatDate } from '@/lib/format'
import { forgetOrganization } from './org-cookie'

interface Props {
  organization: OrganizationResource
  members: MemberResource[]
  invitations: InvitationResource[]
  memberLimit: number
  emailConfigured: boolean
  openInvite: boolean
}

const MEMBER_COLUMNS = 'minmax(220px, 1.8fr) minmax(150px, 1fr) minmax(80px, 0.5fr) minmax(110px, 0.7fr) 40px'
const INVITE_COLUMNS = 'minmax(200px, 1.6fr) minmax(100px, 0.7fr) minmax(130px, 1fr) minmax(130px, 0.9fr) 40px'

function nextPlanWithMoreMembers(current: OrganizationResource['plan']): (typeof PLANS)[number] | null {
  const limit = planLimit(current, 'members')
  return PLANS.slice(PLANS.indexOf(current) + 1).find((plan) => planLimit(plan, 'members') === -1 || planLimit(plan, 'members') > limit) ?? null
}

export function MembersManager({ organization, members, invitations, memberLimit, emailConfigured, openInvite }: Props) {
  const [inviting, setInviting] = useState(openInvite)
  const [shareLink, setShareLink] = useState<{ email: string; url: string; reason: InvitationDelivery['reason'] } | null>(null)
  const isAdmin = hasRole(organization.role, 'admin')
  const pending = invitations.filter((invitation) => invitation.status === 'pending')
  const used = members.length + pending.length
  const atLimit = memberLimit !== -1 && used >= memberLimit
  const upgradeTo = nextPlanWithMoreMembers(organization.plan)

  return (
    <div className="settings-grid">
      {atLimit && isAdmin ? (
        <Banner
          tone="warning"
          action={
            upgradeTo ? (
              <Link className="btn btn-ghost btn-sm" href="/settings/billing">
                {organization.role === 'owner' ? `Upgrade to ${PLAN_INFO[upgradeTo].name}` : 'See plans'}
              </Link>
            ) : null
          }
        >
          {PLAN_INFO[organization.plan].name} includes {memberLimit} members, counting pending invitations, and you are using all of them.
          {upgradeTo ? ` ${PLAN_INFO[upgradeTo].name} ${planLimit(upgradeTo, 'members') === -1 ? 'has no member limit' : `includes ${planLimit(upgradeTo, 'members')}`}.` : ''}
          {organization.role !== 'owner' ? ' Ask an owner to upgrade.' : ''}
        </Banner>
      ) : null}

      <Card>
        <CardHeader
          title={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
          description={
            memberLimit === -1
              ? `${PLAN_INFO[organization.plan].name} plan: no member limit.`
              : `${used} of ${memberLimit} seats used on ${PLAN_INFO[organization.plan].name}, counting pending invitations.`
          }
          actions={
            isAdmin ? (
              <Button variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={() => setInviting(true)} disabled={atLimit} title={atLimit ? 'Your plan has no free seats.' : undefined}>
                Invite member
              </Button>
            ) : null
          }
        />
        <div className="tbl-scroll">
          <div className="tbl" role="table" aria-label="Members" style={{ ['--cols' as string]: MEMBER_COLUMNS, minWidth: 720 }}>
            <div className="tr th" role="row">
              <span role="columnheader">Member</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">2FA</span>
              <span role="columnheader">Joined</span>
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            </div>
            {members.map((member) => (
              <MemberRow key={member.user_id} organization={organization} member={member} />
            ))}
          </div>
        </div>
      </Card>

      {isAdmin ? <InvitationsCard organization={organization} invitations={invitations} onShareLink={setShareLink} /> : null}

      {inviting ? (
        <InviteDialog
          organization={organization}
          emailConfigured={emailConfigured}
          onClose={() => setInviting(false)}
          onShareLink={(link) => {
            setInviting(false)
            setShareLink(link)
          }}
        />
      ) : null}
      {shareLink ? <ShareLinkDialog link={shareLink} onClose={() => setShareLink(null)} /> : null}
    </div>
  )
}

function MemberRow({ organization, member }: { organization: OrganizationResource; member: MemberResource }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { run, pending } = useAction()
  const name = memberDisplayName(member)
  const manageable = canManageMember(organization.role, member.role)
  const roles = assignableRoles(organization.role)
  const base = `/members/${organization.id}/${member.user_id}`

  const changeRole = async (role: OrgRole) => {
    if (role === member.role) return
    let description: string | null = null
    if (member.is_you && !hasRole(role, member.role)) description = `You become ${ORG_ROLE_LABELS[role].toLowerCase()} and may lose access to these settings.`
    else if (role === 'owner') description = `${name} will manage billing, owners and can delete ${organization.name}.`
    else if (member.role === 'owner') description = `${name} will no longer manage billing or other owners.`
    if (description) {
      const ok = await confirm({ title: `Make ${member.is_you ? 'yourself' : name} ${ORG_ROLE_LABELS[role].toLowerCase()}?`, description, confirmLabel: 'Change role', tone: 'primary' })
      if (!ok) return
    }
    await run(() => appRequest(base, { method: 'PATCH', body: { role } }), { success: 'Role changed', successDescription: `${name} is now ${ORG_ROLE_LABELS[role].toLowerCase()}.` })
  }

  const remove = async () => {
    if (member.is_you) {
      const ok = await confirm({ title: `Leave ${organization.name}?`, description: 'You lose access to its status pages, monitors and incidents.', confirmLabel: 'Leave organization' })
      if (!ok) return
      const done = await run(() => appRequest(`/organizations/${organization.id}/leave`, { method: 'POST' }).then(() => true), { success: `You left ${organization.name}`, refresh: false })
      if (done) {
        forgetOrganization()
        router.refresh()
      }
      return
    }
    const ok = await confirm({
      title: `Remove ${name}?`,
      description: `${name} loses access to ${organization.name} right away. API keys they created keep working until you revoke them.`,
      confirmLabel: 'Remove member',
    })
    if (ok) await run(() => appRequest(base, { method: 'DELETE' }), { success: 'Member removed', successDescription: `${name} no longer has access.` })
  }

  const canLeave = member.is_you && !organization.personal
  const showMenu = (manageable && !member.is_you) || canLeave

  return (
    <div className="tr hoverable" role="row">
      <span role="cell" className="row" style={{ ['--gap' as string]: '12px' }}>
        <Avatar name={name} />
        <span className="stack truncate" style={{ ['--gap' as string]: '2px' }}>
          <span className="truncate" style={{ fontWeight: 550 }}>
            {name}
            {member.is_you ? <span className="faint"> (you)</span> : null}
          </span>
          {member.email ? (
            <span className="mono faint truncate" style={{ fontSize: 12 }}>
              {member.email}
            </span>
          ) : null}
        </span>
      </span>
      <span role="cell">
        {manageable ? (
          <Select
            aria-label={`Role of ${name}`}
            value={member.role}
            disabled={pending}
            onChange={(event) => void changeRole(event.target.value as OrgRole)}
            options={ORG_ROLES.filter((role) => roles.includes(role) || role === member.role)
              .slice()
              .reverse()
              .map((role) => ({ value: role, label: ORG_ROLE_LABELS[role] }))}
          />
        ) : (
          <span title={ORG_ROLE_HINTS[member.role]}>{ORG_ROLE_LABELS[member.role]}</span>
        )}
      </span>
      <span role="cell">
        {member.mfa_enabled === null ? <span className="faint">—</span> : member.mfa_enabled ? <Chip tone="success">On</Chip> : <Chip tone={organization.require_2fa ? 'warning' : 'neutral'}>Off</Chip>}
      </span>
      <span role="cell" className="faint" title={formatDate(member.joined_at)}>
        <RelativeTime value={member.joined_at} />
      </span>
      <span role="cell">
        {showMenu ? (
          <Menu
            label={`Actions for ${name}`}
            trigger={(props) => (
              <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label={`Actions for ${name}`} {...props}>
                <MoreIcon size={16} />
              </button>
            )}
          >
            {(close) => (
              <MenuItem
                danger
                icon={member.is_you ? <LogOutIcon size={14} /> : <TrashIcon size={14} />}
                onSelect={() => {
                  close()
                  void remove()
                }}
              >
                {member.is_you ? 'Leave organization' : 'Remove from organization'}
              </MenuItem>
            )}
          </Menu>
        ) : null}
      </span>
    </div>
  )
}

function InvitationsCard({ organization, invitations, onShareLink }: { organization: OrganizationResource; invitations: InvitationResource[]; onShareLink: (link: { email: string; url: string; reason: InvitationDelivery['reason'] }) => void }) {
  const confirm = useConfirm()
  const toast = useToast()
  const { run } = useAction()

  const resend = async (invitation: InvitationResource) => {
    const result = await run(() => appRequest<{ invitation: InvitationResource; delivery: InvitationDelivery }>(`/invitations/${invitation.id}/resend`, { method: 'POST' }))
    if (!result) return
    if (result.delivery.sent) toast.success('Invitation sent again', `${invitation.email} has a new link, valid for 7 days. The old link no longer works.`)
    else if (result.delivery.invite_url) onShareLink({ email: invitation.email, url: result.delivery.invite_url, reason: result.delivery.reason })
  }

  const revoke = async (invitation: InvitationResource) => {
    const ok = await confirm({ title: `Cancel the invitation for ${invitation.email}?`, description: 'The link in the email stops working.', confirmLabel: 'Cancel invitation' })
    if (ok) await run(() => appRequest(`/invitations/${invitation.id}`, { method: 'DELETE' }), { success: 'Invitation cancelled' })
  }

  return (
    <Card>
      <CardHeader title="Invitations" description="People who have not accepted yet. Links work for 7 days and only for the invited address." />
      {invitations.length === 0 ? (
        <EmptyState title="No pending invitations" description={`Invite teammates to ${organization.name}; they get an email with a link to join.`} />
      ) : (
        <div className="tbl-scroll">
          <div className="tbl" role="table" aria-label="Pending invitations" style={{ ['--cols' as string]: INVITE_COLUMNS, minWidth: 680 }}>
            <div className="tr th" role="row">
              <span role="columnheader">Email</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">Invited by</span>
              <span role="columnheader">Expires</span>
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            </div>
            {invitations.map((invitation) => {
              const locked = invitation.role === 'owner' && organization.role !== 'owner'
              return (
                <div className="tr hoverable" role="row" key={invitation.id}>
                  <span role="cell" className="row truncate" style={{ ['--gap' as string]: '10px' }}>
                    <MailIcon size={15} />
                    <span className="mono truncate" style={{ fontSize: 13 }}>
                      {invitation.email}
                    </span>
                  </span>
                  <span role="cell">{ORG_ROLE_LABELS[invitation.role]}</span>
                  <span role="cell" className="truncate">
                    {invitation.invited_by?.name ?? '—'}
                  </span>
                  <span role="cell">
                    {invitation.status === 'expired' ? <Chip tone="warning">Expired</Chip> : <RelativeTime value={invitation.expires_at} />}
                  </span>
                  <span role="cell">
                    {!locked ? (
                      <Menu
                        label={`Actions for the invitation to ${invitation.email}`}
                        trigger={(props) => (
                          <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label={`Actions for the invitation to ${invitation.email}`} {...props}>
                            <MoreIcon size={16} />
                          </button>
                        )}
                      >
                        {(close) => (
                          <>
                            <MenuItem
                              icon={<RefreshIcon size={14} />}
                              onSelect={() => {
                                close()
                                void resend(invitation)
                              }}
                            >
                              {invitation.status === 'expired' ? 'Send a new link' : 'Resend invitation'}
                            </MenuItem>
                            <MenuItem
                              danger
                              icon={<XIcon size={14} />}
                              onSelect={() => {
                                close()
                                void revoke(invitation)
                              }}
                            >
                              Cancel invitation
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

function InviteDialog({
  organization,
  emailConfigured,
  onClose,
  onShareLink,
}: {
  organization: OrganizationResource
  emailConfigured: boolean
  onClose: () => void
  onShareLink: (link: { email: string; url: string; reason: InvitationDelivery['reason'] }) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('responder')
  const { run, pending, fieldErrors } = useAction()
  const toast = useToast()
  const roles = assignableRoles(organization.role).slice().reverse()

  const submit = async () => {
    const result = await run(() => appRequest<{ invitation: InvitationResource; delivery: InvitationDelivery }>('/invitations', { body: { organization_id: organization.id, email, role } }))
    if (!result) return
    if (result.delivery.sent) {
      toast.success('Invitation sent', `${result.invitation.email} can join ${organization.name} as ${ORG_ROLE_LABELS[result.invitation.role].toLowerCase()} for the next 7 days.`)
      onClose()
    } else if (result.delivery.invite_url) {
      onShareLink({ email: result.invitation.email, url: result.delivery.invite_url, reason: result.delivery.reason })
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Invite to ${organization.name}`}
      description="They get an email with a link to join. It works for 7 days, only with this address."
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            Send invitation
          </Button>
        </>
      }
    >
      {!emailConfigured ? <Banner tone="info">Email is not configured on this server. After inviting, you get a link to share yourself.</Banner> : null}
      <Field label="Email address" error={fieldErrors.email}>
        {(props) => <Input {...props} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@company.com" autoComplete="off" autoFocus required />}
      </Field>
      <fieldset className="role-picker">
        <legend className="field-label">Role</legend>
        {roles.map((value) => (
          <label key={value} className={['role-option', role === value ? 'selected' : ''].join(' ')}>
            <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
            <span className="stack" style={{ ['--gap' as string]: '2px' }}>
              <strong>{ORG_ROLE_LABELS[value]}</strong>
              <span className="help">{ORG_ROLE_HINTS[value]}</span>
            </span>
          </label>
        ))}
        {fieldErrors.role ? <span className="field-error">{fieldErrors.role}</span> : null}
      </fieldset>
    </Dialog>
  )
}

function ShareLinkDialog({ link, onClose }: { link: { email: string; url: string; reason: InvitationDelivery['reason'] }; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Share the invitation link"
      description={
        link.reason === 'failed'
          ? `The email to ${link.email} could not be sent. Share this link with them another way.`
          : `Email is not configured on this server, so nothing was sent. Share this link with ${link.email}.`
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="secret">
        <span className="grow">{link.url}</span>
        <CopyButton value={link.url} />
      </div>
      <span className="help">The link works once, for 7 days, and only for {link.email}. Anyone you send it to can see your organization name.</span>
    </Dialog>
  )
}
