'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { DELIVERY_STATUSES } from '@shared/domain.ts'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { useConfirm } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { Switch } from '@/components/ui/Field'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Chip } from '@/components/ui/Status'
import { RelativeTime } from '@/components/ui/Time'
import { ArrowDownIcon, ArrowUpIcon, MoreIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, TrashIcon, ZapIcon } from '@/components/ui/icons'
import { appRequest } from '@/lib/client/api'
import { useAction } from '@/lib/client/use-action'
import type { AlertChannelResource, AlertRuleResource, AlertSettingsResource, AlertTestResult } from '@/lib/domain/schemas/alerts'
import { suppressionText } from '@/lib/domain/schemas/alerts'
import { ChannelDialog } from './ChannelDialog'
import { CHANNEL_META, ChannelTypeIcon } from './channel-meta'
import { describeRule } from './rule-sentence'
import { RuleDialog } from './RuleDialog'

interface Props {
  projectId: string
  settings: AlertSettingsResource
  channels: AlertChannelResource[]
  rules: AlertRuleResource[]
  components: Array<{ id: string; name: string }>
  monitors: Array<{ id: string; name: string }>
  canEdit: boolean
  pagingAllowed: boolean
}

const DELIVERY_TEXT: Record<(typeof DELIVERY_STATUSES)[number], string> = {
  pending: 'Queued',
  processing: 'Sending',
  retryable: 'Retrying',
  sent: 'Delivered',
  failed: 'Failed',
  suppressed: 'Held back',
}

export function AlertsManager({ projectId, settings, channels, rules, components, monitors, canEdit, pagingAllowed }: Props) {
  const [channelDialog, setChannelDialog] = useState<AlertChannelResource | 'new' | null>(null)
  const [ruleDialog, setRuleDialog] = useState<AlertRuleResource | 'new' | null>(null)
  const [dialogKey, setDialogKey] = useState(0)
  const confirm = useConfirm()
  const { run, pending } = useAction()
  const toast = useToast()
  const base = `/projects/${projectId}`

  const lookups = useMemo(
    () => ({
      channels: new Map(channels.map((channel) => [channel.id, { name: channel.name, enabled: channel.enabled }])),
      components: new Map(components.map((component) => [component.id, component.name])),
      monitors: new Map(monitors.map((monitor) => [monitor.id, monitor.name])),
    }),
    [channels, components, monitors],
  )
  const ordered = useMemo(() => [...rules].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)), [rules])
  const usedBy = (channelId: string) => rules.filter((rule) => rule.channel_ids.includes(channelId)).length

  const openChannel = (value: AlertChannelResource | 'new') => {
    setDialogKey((key) => key + 1)
    setChannelDialog(value)
  }
  const openRule = (value: AlertRuleResource | 'new') => {
    setDialogKey((key) => key + 1)
    setRuleDialog(value)
  }

  const updateSettings = (patch: Partial<AlertSettingsResource>) =>
    run(() => appRequest(`${base}/alert-settings`, { method: 'PATCH', body: patch }), {
      success: patch.enabled === false ? 'Alerts turned off' : patch.enabled === true ? 'Alerts turned on' : 'Settings saved',
    })

  const move = (rule: AlertRuleResource, direction: -1 | 1) => {
    const index = ordered.findIndex((item) => item.id === rule.id)
    const target = ordered[index + direction]
    if (!target) return
    const next = [...ordered]
    next[index] = target
    next[index + direction] = rule
    void run(() => appRequest(`${base}/alert-rules/reorder`, { body: { rule_ids: next.map((item) => item.id) } }), { success: 'Order saved' })
  }

  const toggleRule = (rule: AlertRuleResource) =>
    run(() => appRequest(`${base}/alert-rules/${rule.id}`, { method: 'PATCH', body: { enabled: !rule.enabled } }), { success: rule.enabled ? 'Rule turned off' : 'Rule turned on' })

  const removeRule = async (rule: AlertRuleResource) => {
    const ok = await confirm({ title: `Delete ${rule.name}?`, description: 'Events it matched stop going to its channels. Other rules keep working.', confirmLabel: 'Delete rule' })
    if (ok) await run(() => appRequest(`${base}/alert-rules/${rule.id}`, { method: 'DELETE' }), { success: 'Rule deleted' })
  }

  const toggleChannel = (channel: AlertChannelResource) =>
    run(() => appRequest(`${base}/alert-channels/${channel.id}`, { method: 'PATCH', body: { enabled: !channel.enabled } }), { success: channel.enabled ? 'Channel paused' : 'Channel resumed' })

  const removeChannel = async (channel: AlertChannelResource) => {
    const count = usedBy(channel.id)
    const ok = await confirm({
      title: `Delete ${channel.name}?`,
      description: count > 0 ? `${count} ${count === 1 ? 'rule sends' : 'rules send'} to it. They keep their other channels.` : 'No rule sends to it.',
      confirmLabel: 'Delete channel',
    })
    if (ok) await run(() => appRequest(`${base}/alert-channels/${channel.id}`, { method: 'DELETE' }), { success: 'Channel deleted' })
  }

  const test = async (channel: AlertChannelResource) => {
    const result = await run(() => appRequest<AlertTestResult>(`${base}/alert-channels/${channel.id}/test`, { method: 'POST' }))
    if (!result) return
    if (result.deliveries === 0) toast.error('Test alert not sent', suppressionText(result.suppression_reason) ?? 'This channel has no confirmed recipient yet.')
    else toast.success('Test alert sent', `Check ${channel.name}. The result appears in Activity in a few seconds.`)
  }

  const resend = (channel: AlertChannelResource, email: string) =>
    run(() => appRequest(`${base}/alert-channels/${channel.id}/resend-verification`, { body: { email } }), { success: 'Confirmation sent', successDescription: `${email} has a new link.` })

  return (
    <>
      {!settings.enabled ? (
        <Banner tone="warning" action={canEdit ? <Button size="sm" onClick={() => void updateSettings({ enabled: true })}>Turn alerts on</Button> : null}>
          Alerts are off for this status page. Events are logged as held back and nothing is sent, except test alerts.
        </Banner>
      ) : null}

      <Card>
        <CardHeader
          title="Routing rules"
          description="Rules match events and send them to channels. A channel gets each event once, even when several rules match."
          actions={
            canEdit ? (
              <Button variant="primary" size="sm" icon={<PlusIcon size={14} />} onClick={() => openRule('new')}>
                Add rule
              </Button>
            ) : null
          }
        />
        {ordered.length === 0 ? (
          <EmptyState
            title="No rules yet"
            description="Without a rule, events are only logged. Start with one rule that sends outages, monitor failures and incidents to your on-call channel."
            action={canEdit ? <Button variant="primary" onClick={() => openRule('new')}>Add rule</Button> : null}
          />
        ) : (
          <div className="al-rules">
            {ordered.map((rule, index) => {
              const sentence = describeRule(rule, lookups)
              return (
                <div key={rule.id} className={['al-rule', rule.enabled ? '' : 'off'].join(' ')}>
                  <span className="al-rule-n" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="al-rule-body">
                    <span className="al-rule-name">
                      {rule.name}
                      {!rule.enabled ? <span className="faint" style={{ fontWeight: 500 }}> (off)</span> : null}
                    </span>
                    <span className="al-rule-flow">
                      <span>{sentence.events}</span>
                      <span className="arrow" aria-label="sent to">
                        →
                      </span>
                      <span>{sentence.channels}</span>
                    </span>
                    <span className="al-rule-details">
                      {sentence.details.map((detail) => (
                        <span key={detail}>{detail.charAt(0).toUpperCase() + detail.slice(1)}</span>
                      ))}
                    </span>
                    {sentence.warnings.map((warning) => (
                      <span key={warning} className="al-rule-warn">
                        {warning}
                      </span>
                    ))}
                  </div>
                  {canEdit ? (
                    <div className="al-rule-actions">
                      <Button variant="quiet" size="sm" iconOnly icon={<ArrowUpIcon size={14} />} aria-label={`Move ${rule.name} up`} disabled={index === 0 || pending} onClick={() => move(rule, -1)} />
                      <Button variant="quiet" size="sm" iconOnly icon={<ArrowDownIcon size={14} />} aria-label={`Move ${rule.name} down`} disabled={index === ordered.length - 1 || pending} onClick={() => move(rule, 1)} />
                      <Menu
                        label={`Actions for ${rule.name}`}
                        trigger={(props) => (
                          <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label={`Actions for ${rule.name}`} {...props}>
                            <MoreIcon size={16} />
                          </button>
                        )}
                      >
                        {(close) => (
                          <>
                            <MenuItem icon={<PencilIcon size={14} />} onSelect={() => { close(); openRule(rule) }}>
                              Edit
                            </MenuItem>
                            <MenuItem icon={rule.enabled ? <PauseIcon size={14} /> : <PlayIcon size={14} />} onSelect={() => { close(); void toggleRule(rule) }}>
                              {rule.enabled ? 'Turn off' : 'Turn on'}
                            </MenuItem>
                            <MenuItem icon={<TrashIcon size={14} />} danger onSelect={() => { close(); void removeRule(rule) }}>
                              Delete
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Channels"
          description="Where alerts go. Secrets are encrypted and never shown again."
          actions={
            canEdit ? (
              <Button size="sm" icon={<PlusIcon size={14} />} onClick={() => openChannel('new')}>
                Add channel
              </Button>
            ) : null
          }
        />
        {channels.length === 0 ? (
          <EmptyState
            title="No channels yet"
            description="Add email for the team, Slack, Teams or Discord for a shared channel, a signed webhook for your own tools, or PagerDuty and Opsgenie to page on-call."
            action={canEdit ? <Button variant="primary" onClick={() => openChannel('new')}>Add channel</Button> : null}
          />
        ) : (
          <div className="al-channels">
            {channels.map((channel) => {
              const count = usedBy(channel.id)
              return (
                <div key={channel.id} className="al-channel">
                  <ChannelTypeIcon type={channel.type} />
                  <div className="al-channel-body">
                    <span className="al-channel-head">
                      <strong>{channel.name}</strong>
                      {!channel.enabled ? <Chip>Paused</Chip> : null}
                      {channel.type === 'webhook' && channel.config.signed === true ? <Chip tone="accent">Signed</Chip> : null}
                    </span>
                    <span className="al-channel-meta">
                      <span>{CHANNEL_META[channel.type].label}</span>
                      {channel.secret_hint ? <span className="mono">{channel.secret_hint}</span> : null}
                      <span>{count === 0 ? 'No rule sends here' : `${count} ${count === 1 ? 'rule' : 'rules'}`}</span>
                      {channel.last_delivery ? (
                        <span className={['al-delivery', channel.last_delivery.status === 'failed' ? 's-major' : ''].join(' ')} title={channel.last_delivery.error_message ?? undefined}>
                          {DELIVERY_TEXT[channel.last_delivery.status]} <RelativeTime value={channel.last_delivery.at} />
                        </span>
                      ) : (
                        <span>Nothing sent yet</span>
                      )}
                    </span>
                    {channel.last_delivery?.status === 'failed' && channel.last_delivery.error_message ? <span className="al-rule-warn">{channel.last_delivery.error_message}</span> : null}
                    {channel.recipients && channel.recipients.length > 0 ? (
                      <span className="al-recipients">
                        {channel.recipients.map((recipient) => (
                          <span key={recipient.email} className={['al-recipient', recipient.verified ? 'ok' : 'pending'].join(' ')} title={recipient.verified ? 'Confirmed' : 'Waiting for confirmation'}>
                            {recipient.email}
                            {!recipient.verified ? (
                              <>
                                <span className="faint">{recipient.verification_sent_at ? 'pending' : 'not sent'}</span>
                                {canEdit ? (
                                  <button type="button" onClick={() => void resend(channel, recipient.email)}>
                                    Resend
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="al-rule-actions">
                      <Button size="sm" icon={<ZapIcon size={14} />} onClick={() => void test(channel)} disabled={pending}>
                        Send test
                      </Button>
                      <Menu
                        label={`Actions for ${channel.name}`}
                        trigger={(props) => (
                          <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label={`Actions for ${channel.name}`} {...props}>
                            <MoreIcon size={16} />
                          </button>
                        )}
                      >
                        {(close) => (
                          <>
                            <MenuItem icon={<PencilIcon size={14} />} onSelect={() => { close(); openChannel(channel) }}>
                              Edit
                            </MenuItem>
                            <MenuItem icon={channel.enabled ? <PauseIcon size={14} /> : <PlayIcon size={14} />} onSelect={() => { close(); void toggleChannel(channel) }}>
                              {channel.enabled ? 'Pause' : 'Resume'}
                            </MenuItem>
                            <MenuItem icon={<TrashIcon size={14} />} danger onSelect={() => { close(); void removeChannel(channel) }}>
                              Delete
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Settings" />
        <div className="card-b stack" style={{ ['--gap' as string]: '14px' }}>
          <Switch label="Send alerts for this status page" checked={settings.enabled} disabled={!canEdit || pending} onChange={(checked) => void updateSettings({ enabled: checked })} />
          <Switch
            label="Mute component and monitor alerts during maintenance windows that mute alerts"
            checked={settings.mute_during_maintenance}
            disabled={!canEdit || pending}
            onChange={(checked) => void updateSettings({ mute_during_maintenance: checked })}
          />
          <p className="help">
            Every event, sent or held back, is in <Link className="link" href={`/p/${projectId}/alerts/activity`}>Activity</Link> with the reason.
          </p>
        </div>
      </Card>

      {channelDialog !== null ? <ChannelDialog key={`c${dialogKey}`} projectId={projectId} editing={channelDialog} pagingAllowed={pagingAllowed} onClose={() => setChannelDialog(null)} /> : null}
      {ruleDialog !== null ? <RuleDialog key={`r${dialogKey}`} projectId={projectId} editing={ruleDialog} channels={channels} components={components} monitors={monitors} onClose={() => setRuleDialog(null)} /> : null}
    </>
  )
}
