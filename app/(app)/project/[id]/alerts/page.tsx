'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/hooks/useToast'
import { useAuth } from '@/lib/auth/provider'
import { useStore } from '@/lib/store/provider'
import { formatDateTime } from '@/lib/utils/helpers'
import { DEFAULT_ALERT_TYPE_TOGGLES } from '@/lib/alerts/config'
import type { AlertChannelConfigMetadata, AlertEmailChannelConfig, AlertProjectConfig, AlertTypeToggles } from '@/lib/alerts/types'

const CHANNEL_PANEL = {
  EMAIL: 'email',
  SLACK: 'slack',
} as const

type ChannelPanel = (typeof CHANNEL_PANEL)[keyof typeof CHANNEL_PANEL]

interface ChannelCardView {
  type: ChannelPanel
  label: string
  description: string
  icon: 'mail' | 'slack'
  status: string
  available: boolean
}

interface AlertsResponse {
  projectConfig: AlertProjectConfig
  emailChannel: { enabled: boolean; config: AlertEmailChannelConfig }
  channels: AlertChannelConfigMetadata[]
  deliveries: AlertDeliveryRow[]
}

interface AlertDeliveryRow {
  id: string
  target: string
  status: string
  provider: string | null
  error_message: string | null
  created_at: string
  sent_at: string | null
  alert_events?: { type: string; payload?: { reason?: string } }
}

export default function ProjectAlertsPage() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()
  const { user } = useAuth()
  const { addToast } = useToast()
  const { getProjectById } = useStore()
  const project = getProjectById(projectId)
  const [loading, setLoading] = useState(true)
  const [savingProject, setSavingProject] = useState(false)
  const [savingChannel, setSavingChannel] = useState(false)
  const [savingTypes, setSavingTypes] = useState(false)
  const [testing, setTesting] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [recipientsText, setRecipientsText] = useState('')
  const [cooldown, setCooldown] = useState(30)
  const [notifyRecovery, setNotifyRecovery] = useState(true)
  const [alertTypes, setAlertTypes] = useState<AlertTypeToggles>(DEFAULT_ALERT_TYPE_TOGGLES)
  const [deliveries, setDeliveries] = useState<AlertDeliveryRow[]>([])
  const [channels, setChannels] = useState<AlertChannelConfigMetadata[]>([])
  const [openChannel, setOpenChannel] = useState<ChannelPanel | null>(null)

  useEffect(() => {
    async function loadAlerts() {
      if (!projectId || !project) return
      setLoading(true)
      const response = await fetch(`/api/alerts/config?${new URLSearchParams({ projectId }).toString()}`)
      const payload = await response.json()
      if (!response.ok) {
        addToast(formatAlertError(payload, 'Could not load alert settings.'), 'error')
        setLoading(false)
        return
      }
      const data = payload as AlertsResponse
      setEnabled(data.projectConfig.enabled)
      setCooldown(data.projectConfig.cooldown_minutes)
      setNotifyRecovery(data.projectConfig.notify_recovery)
      setAlertTypes(data.projectConfig.alert_types)
      setEmailEnabled(data.emailChannel.enabled)
      setRecipientsText(data.emailChannel.config.recipients.join('\n'))
      setChannels(data.channels)
      setDeliveries(data.deliveries)
      setLoading(false)
    }
    void loadAlerts()
  }, [projectId, project, addToast])

  if (!project || !user) {
    return <EmptyState title="Project not found" description="This project doesn't exist or you don't have access." action={<Button variant="primary" onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>} />
  }

  async function saveProjectAlerts() {
    setSavingProject(true)
    const response = await fetch('/api/alerts/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        projectConfig: { enabled, cooldown_minutes: cooldown, notify_recovery: notifyRecovery, alert_types: alertTypes },
      }),
    })
    const payload = await response.json()
    if (!response.ok) addToast(formatAlertError(payload, 'Could not save alerting.'), 'error')
    else addToast('Project alerting saved.', 'success')
    setSavingProject(false)
  }

  async function saveEmailChannel() {
    setSavingChannel(true)
    const response = await fetch('/api/alerts/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        emailChannel: { enabled: emailEnabled, config: { recipients: parseRecipients(recipientsText), template_variant: 'default' } },
      }),
    })
    const payload = await response.json()
    if (!response.ok) addToast(formatAlertError(payload, 'Could not save email channel.'), 'error')
    else addToast('Email channel saved.', 'success')
    setSavingChannel(false)
  }

  async function saveAlertTypes() {
    setSavingTypes(true)
    const response = await fetch('/api/alerts/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        projectConfig: { enabled, cooldown_minutes: cooldown, notify_recovery: notifyRecovery, alert_types: alertTypes },
      }),
    })
    const payload = await response.json()
    if (!response.ok) addToast(formatAlertError(payload, 'Could not save alert types.'), 'error')
    else addToast('Alert types saved.', 'success')
    setSavingTypes(false)
  }

  async function sendTest() {
    setTesting(true)
    const response = await fetch('/api/alerts/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    })
    const payload = await response.json()
    if (!response.ok) addToast(formatAlertError(payload, 'Could not queue test alert.'), 'error')
    else addToast('Test alert queued. Upvane will invoke the alert worker automatically.', 'success')
    setTesting(false)
  }

  function updateAlertType(key: keyof AlertTypeToggles, value: boolean) {
    setAlertTypes((prev) => ({ ...prev, [key]: value }))
  }

  function toggleChannelPanel(channel: ChannelPanel) {
    setOpenChannel((current) => (current === channel ? null : channel))
  }

  const emailMetadata = channels.find((channel) => channel.type === CHANNEL_PANEL.EMAIL)
  const channelCards: ChannelCardView[] = [
    {
      type: CHANNEL_PANEL.EMAIL,
      label: emailMetadata?.label ?? 'Email',
      description: emailMetadata?.description ?? 'Send operational alerts to one or more inboxes through Resend.',
      icon: 'mail',
      status: emailEnabled ? 'Configured' : 'Available',
      available: true,
    },
    {
      type: CHANNEL_PANEL.SLACK,
      label: 'Slack',
      description: 'Preview team notifications for incident and component health changes.',
      icon: 'slack',
      status: 'Preview only',
      available: false,
    },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-description">Route Upvane operational alerts for {project.name} through a queued worker with automatic fallback delivery.</p>
        </div>
        <div className="monitoring-header-actions">
          <Link className="btn btn-ghost btn-sm" href={`/project/${projectId}/monitoring`}>Monitoring</Link>
          <Link className="btn btn-ghost btn-sm" href={`/project/${projectId}`}>Back to project</Link>
        </div>
      </div>

      {loading ? <div className="monitoring-loading"><Spinner size={24} /></div> : (
        <div className="monitoring-grid">
          <section className="monitoring-card" data-collapsed="false">
            <div className="monitoring-card-header">
              <div><h2>Project alerting</h2><p>Turn alert evaluation on or off and control recovery/cooldown behavior. Incident lifecycle alerts default off until you opt in.</p></div>
              <Button variant="primary" loading={savingProject} onClick={saveProjectAlerts}>Save alerting</Button>
            </div>
            <div className="alerts-form-grid">
              <label className="alerts-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable alerts</label>
              <label className="alerts-toggle"><input type="checkbox" checked={notifyRecovery} onChange={(event) => setNotifyRecovery(event.target.checked)} /> Notify recovery</label>
              <Input label="Cooldown minutes" type="number" min={0} max={1440} value={cooldown} onChange={(event) => setCooldown(Number(event.target.value))} />
            </div>
          </section>

          <section className="monitoring-card" data-collapsed="false">
            <div className="monitoring-card-header">
              <div><h2>Channels</h2><p>Select delivery channels. Email is available now; future tenant channels will resolve secrets from Vault without changing queue messages.</p></div>
              <div className="monitoring-header-actions">
                <Button variant="subtle" loading={testing} disabled={!enabled || !emailEnabled} onClick={sendTest}>Send test</Button>
              </div>
            </div>
            <div className="alerts-channel-cards">
              {channelCards.map((channel) => (
                <button
                  aria-controls={`alerts-${channel.type}-panel`}
                  aria-expanded={openChannel === channel.type}
                  className="alerts-channel-card"
                  data-selected={openChannel === channel.type}
                  key={channel.type}
                  onClick={() => toggleChannelPanel(channel.type)}
                  type="button"
                >
                  <span className="alerts-channel-icon" aria-hidden="true"><ChannelIcon icon={channel.icon} /></span>
                  <span className="alerts-channel-copy">
                    <span className="alerts-channel-title-row"><strong>{channel.label}</strong><small data-available={channel.available}>{channel.status}</small></span>
                    <span className="alerts-channel-description">{channel.description}</span>
                  </span>
                </button>
              ))}
            </div>
            {openChannel === CHANNEL_PANEL.EMAIL && (
              <div className="alerts-channel-panel" id="alerts-email-panel">
                <div className="alerts-channel-panel-header">
                  <div><h3>Email configuration</h3><p>Keep using Resend for production alert deliveries. Saving here only updates the email channel.</p></div>
                  <Button variant="primary" loading={savingChannel} onClick={saveEmailChannel}>Save email</Button>
                </div>
                <div className="alerts-form-grid">
                  <label className="alerts-toggle"><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} /> Enable email</label>
                  <label className="input-group alerts-recipients">
                    <span className="input-label">Recipients</span>
                    <textarea className="input" rows={6} value={recipientsText} placeholder="ops@company.com&#10;founder@company.com" onChange={(event) => setRecipientsText(event.target.value)} />
                    <span className="monitoring-field-hint">One email per line or comma-separated. Invalid or duplicate recipients are rejected without saving partial state.</span>
                  </label>
                </div>
              </div>
            )}
            {openChannel === CHANNEL_PANEL.SLACK && (
              <div className="alerts-channel-panel" id="alerts-slack-panel">
                <div className="alerts-channel-panel-header">
                  <div><h3>Slack preview</h3><p>This panel validates the multi-channel layout only. No Slack tokens, webhook URLs, or backend secrets are stored yet.</p></div>
                  <span className="alerts-channel-preview-badge">Coming soon</span>
                </div>
                <div className="alerts-slack-preview">
                  <div className="alerts-slack-message"><strong>Component health changed</strong><span>Upvane will route channel-specific Slack deliveries here after the adapter and Vault secret flow are implemented.</span></div>
                  <p>Preview only: email remains the active functional channel for this project.</p>
                </div>
              </div>
            )}
          </section>

          <section className="monitoring-card" data-collapsed="false">
            <div className="monitoring-card-header"><div><h2>Alert types</h2><p>Choose which operational events create queued deliveries. Component and monitor status overlap is grouped as component health changes.</p></div><Button variant="primary" loading={savingTypes} onClick={saveAlertTypes}>Save types</Button></div>
            <div className="alerts-type-grid">
              <label><input type="checkbox" checked={alertTypes.component_status} onChange={(event) => updateAlertType('component_status', event.target.checked)} /> Component health changes</label>
              <label><input type="checkbox" checked={alertTypes.monitor_failure} onChange={(event) => updateAlertType('monitor_failure', event.target.checked)} /> Monitor failures and recoveries</label>
              <label><input type="checkbox" checked={alertTypes.incident_created} onChange={(event) => updateAlertType('incident_created', event.target.checked)} /> Incident created</label>
              <label><input type="checkbox" checked={alertTypes.incident_updated} onChange={(event) => updateAlertType('incident_updated', event.target.checked)} /> Incident updated</label>
              <label><input type="checkbox" checked={alertTypes.incident_resolved} onChange={(event) => updateAlertType('incident_resolved', event.target.checked)} /> Incident resolved</label>
            </div>
          </section>
        </div>
      )}

      <section className="editor-section monitoring-results">
        <div className="editor-section-header"><h2 className="editor-section-title">Recent deliveries</h2></div>
        {deliveries.length === 0 ? <EmptyState title="No deliveries yet" description="Alert deliveries will appear after events are processed." /> : (
          <div className="monitoring-results-list">
            {deliveries.map((delivery) => (
              <div className="alert-delivery-row" key={delivery.id}>
                <span>{delivery.alert_events?.type?.replace(/_/g, ' ') ?? 'alert'}</span>
                <span>{delivery.target}</span>
                <span className={`monitoring-result-status monitoring-result-status-${delivery.status === 'sent' ? 'success' : 'failure'}`}>{delivery.status}</span>
                <span>{delivery.provider ?? '—'}</span>
                <span>{delivery.error_message ?? '—'}</span>
                <span>{formatDateTime(delivery.sent_at ?? delivery.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function parseRecipients(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function formatAlertError(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback
  const error = (payload as Record<string, unknown>).error
  return typeof error === 'string' ? error : fallback
}

function ChannelIcon({ icon }: { icon: ChannelCardView['icon'] }) {
  if (icon === 'slack') {
    return (
      <svg viewBox="0 0 24 24" role="img" focusable="false">
        <path d="M9.2 3.5a2 2 0 0 1 4 0v5.3h-4z" />
        <path d="M14.8 9.2h5.3a2 2 0 1 1 0 4h-5.3z" />
        <path d="M10.8 14.8v5.3a2 2 0 1 1-4 0v-5.3z" />
        <path d="M3.9 10.8a2 2 0 1 1 0-4h5.3v4z" />
        <path d="M14.8 3.5a2 2 0 0 1 4 0v1.7h-4z" />
        <path d="M18.8 14.8h1.7a2 2 0 1 1 0 4h-1.7z" />
        <path d="M5.2 18.8H3.5a2 2 0 1 1 0-4h1.7z" />
        <path d="M3.5 5.2a2 2 0 1 1 0-4h1.7v4z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" role="img" focusable="false">
      <path d="M4 6.75A2.75 2.75 0 0 1 6.75 4h10.5A2.75 2.75 0 0 1 20 6.75v10.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m6.5 8 5.5 4.25L17.5 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  )
}
