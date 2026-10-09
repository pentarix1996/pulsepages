'use client'

import { useState } from 'react'
import type { AlertChannelType } from '@shared/domain.ts'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { SecretValue } from '@/components/ui/Code'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { AlertChannelResource } from '@/lib/domain/schemas/alerts'
import { CHANNEL_META, CHANNEL_TYPES, ChannelTypeIcon } from './channel-meta'

interface Props {
  projectId: string
  /** null: closed; 'new': create; a channel: edit. */
  editing: AlertChannelResource | 'new' | null
  pagingAllowed: boolean
  onClose: () => void
}

export function ChannelDialog({ projectId, editing, pagingAllowed, onClose }: Props) {
  // Keyed by the caller so state resets per opening.
  const channel = editing && editing !== 'new' ? editing : null
  const [type, setType] = useState<AlertChannelType>(channel?.type ?? 'email')
  const [name, setName] = useState(channel?.name ?? CHANNEL_META.email.defaultName)
  const [secret, setSecret] = useState('')
  const [recipients, setRecipients] = useState((channel?.recipients ?? []).map((recipient) => recipient.email).join('\n'))
  const [region, setRegion] = useState(String(channel?.config.region ?? 'us'))
  const [signed, setSigned] = useState(channel ? channel.config.signed === true : true)
  const [rotate, setRotate] = useState(false)
  const [signingSecret, setSigningSecret] = useState<string | null>(null)
  const { run, pending, fieldErrors } = useAction()
  const meta = CHANNEL_META[type]

  const chooseType = (next: AlertChannelType) => {
    const renamed = name.trim() === '' || CHANNEL_TYPES.some((item) => item.defaultName === name)
    setType(next)
    if (renamed) setName(CHANNEL_META[next].defaultName)
  }

  const submit = async () => {
    const body: Record<string, unknown> = { type, name: name.trim() }
    if (meta.secretField && secret.trim() !== '') body.secret = { [meta.secretField.key]: secret.trim() }
    if (type === 'email') {
      body.recipients = recipients
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    }
    if (type === 'opsgenie') body.config = { region }
    if (type === 'webhook') {
      if (!channel && signed) body.generate_signing_secret = true
      if (channel && signed && (rotate || channel.config.signed !== true)) body.generate_signing_secret = true
      if (channel && !signed && channel.config.signed === true) body.secret = { ...((body.secret as Record<string, unknown>) ?? {}), signing_secret: null }
    }
    const saved = await run(
      () => (channel ? appRequest<AlertChannelResource>(`/projects/${projectId}/alert-channels/${channel.id}`, { method: 'PATCH', body }) : appRequest<AlertChannelResource>(`/projects/${projectId}/alert-channels`, { body })),
      {
        success: channel ? 'Channel saved' : 'Channel added',
        successDescription:
          type === 'email' && (recipients.trim() !== '')
            ? 'Organization members get alerts right away. Other addresses get a confirmation email first.'
            : channel
              ? undefined
              : 'Send a test alert to check that it arrives.',
      },
    )
    if (!saved) return
    if (saved.signing_secret) setSigningSecret(saved.signing_secret)
    else onClose()
  }

  if (signingSecret) {
    return (
      <Dialog open onClose={onClose} title="Copy the signing secret" description="Use it to verify the Upvane-Signature header of each request." footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <SecretValue value={signingSecret} />
      </Dialog>
    )
  }

  return (
    <Dialog
      open={editing !== null}
      onClose={onClose}
      title={channel ? `Edit ${channel.name}` : 'Add channel'}
      description={channel ? meta.blurb : 'Where alerts go. Rules decide which events each channel gets.'}
      wide
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {channel ? 'Save channel' : 'Add channel'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {!channel ? (
          <div className="al-type-grid" role="group" aria-label="Channel type">
            {CHANNEL_TYPES.map((item) => {
              const locked = item.paging && !pagingAllowed
              return (
                <button key={item.type} type="button" className="al-type-btn" aria-pressed={type === item.type} disabled={locked} onClick={() => chooseType(item.type)}>
                  <ChannelTypeIcon type={item.type} />
                  <span>
                    <strong>{item.label}</strong>
                    <span className="help">{locked ? 'Business plan' : item.blurb}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}

        <ol className="al-steps">
          {meta.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>

        <Field label="Name" hint="How the channel appears in rules and the activity log." error={fieldErrors.name}>
          {(props) => <Input {...props} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />}
        </Field>

        {meta.secretField ? (
          <Field
            label={meta.secretField.label}
            hint={channel?.secret_hint ? `Saved: ${channel.secret_hint}. Leave empty to keep it.` : 'Stored encrypted. Upvane never shows it again.'}
            error={fieldErrors[`secret.${meta.secretField.key}`] ?? fieldErrors.secret}
          >
            {(props) => (
              <Input
                {...props}
                className={meta.secretField?.mono ? 'mono' : undefined}
                type={type === 'webhook' ? 'url' : 'password'}
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder={channel ? 'Leave empty to keep the saved value' : meta.secretField?.placeholder}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
        ) : null}

        {type === 'email' ? (
          <Field label="Recipients" hint="One address per line, up to 20." error={fieldErrors.recipients ?? Object.entries(fieldErrors).find(([key]) => key.startsWith('recipients.'))?.[1]}>
            {(props) => <Textarea {...props} className="mono" rows={4} value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder={'oncall@example.com\nplatform-team@example.com'} />}
          </Field>
        ) : null}

        {type === 'opsgenie' ? (
          <Field label="Region">
            {(props) => (
              <Select
                {...props}
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                options={[
                  { value: 'us', label: 'US (app.opsgenie.com)' },
                  { value: 'eu', label: 'EU (app.eu.opsgenie.com)' },
                ]}
              />
            )}
          </Field>
        ) : null}

        {type === 'webhook' ? (
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <Checkbox label="Sign requests with an Upvane-Signature header" checked={signed} onChange={setSigned} />
            {channel && signed && channel.config.signed === true ? <Checkbox label="Generate a new signing secret (the old one stops working)" checked={rotate} onChange={setRotate} /> : null}
          </div>
        ) : null}

        {meta.paging ? <Banner tone="info">Paging channels get outages, monitor failures and incidents. Recoveries and resolved incidents close the page on their own.</Banner> : null}
      </div>
    </Dialog>
  )
}
