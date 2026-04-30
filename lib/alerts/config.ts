import { ALERT_CHANNEL_TYPE, ALERT_TYPE_CONFIG_KEYS, type AlertEmailChannelConfig, type AlertProjectConfig, type AlertTypeToggles } from './types'

export const ALERT_LIMITS = {
  MIN_COOLDOWN_MINUTES: 0,
  MAX_COOLDOWN_MINUTES: 1440,
  DEFAULT_COOLDOWN_MINUTES: 30,
  MAX_RECIPIENTS: 20,
  RECENT_DELIVERIES_LIMIT: 20,
} as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const DEFAULT_ALERT_TYPE_TOGGLES: AlertTypeToggles = {
  component_status: true,
  monitor_failure: true,
  incident_created: false,
  incident_updated: false,
  incident_resolved: false,
}

export const DEFAULT_PROJECT_ALERT_CONFIG: AlertProjectConfig = {
  enabled: false,
  cooldown_minutes: ALERT_LIMITS.DEFAULT_COOLDOWN_MINUTES,
  notify_recovery: true,
  alert_types: DEFAULT_ALERT_TYPE_TOGGLES,
}

export const DEFAULT_EMAIL_CHANNEL_CONFIG: AlertEmailChannelConfig = {
  recipients: [],
  template_variant: 'default',
}

export function normalizeRecipients(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('Recipients must be an array.')
  const normalized = input.map((item) => {
    if (typeof item !== 'string') throw new Error('Each recipient must be an email address.')
    return item.trim().toLowerCase()
  }).filter(Boolean)

  if (normalized.length > ALERT_LIMITS.MAX_RECIPIENTS) throw new Error(`Email alerts support up to ${ALERT_LIMITS.MAX_RECIPIENTS} recipients.`)
  const unique = new Set<string>()
  for (const email of normalized) {
    if (!EMAIL_RE.test(email)) throw new Error(`Invalid recipient email: ${email}`)
    if (unique.has(email)) throw new Error(`Duplicate recipient email: ${email}`)
    unique.add(email)
  }
  return [...unique]
}

export function normalizeAlertTypeToggles(input: unknown): AlertTypeToggles {
  if (typeof input !== 'object' || input === null) return DEFAULT_ALERT_TYPE_TOGGLES
  const data = input as Record<string, unknown>
  return {
    [ALERT_TYPE_CONFIG_KEYS.COMPONENT_STATUS]: data.component_status === undefined ? true : data.component_status === true,
    [ALERT_TYPE_CONFIG_KEYS.MONITOR_FAILURE]: data.monitor_failure === undefined ? true : data.monitor_failure === true,
    [ALERT_TYPE_CONFIG_KEYS.INCIDENT_CREATED]: data.incident_created === true,
    [ALERT_TYPE_CONFIG_KEYS.INCIDENT_UPDATED]: data.incident_updated === true,
    [ALERT_TYPE_CONFIG_KEYS.INCIDENT_RESOLVED]: data.incident_resolved === true,
  }
}

export function normalizeProjectAlertConfig(input: unknown): AlertProjectConfig {
  if (typeof input !== 'object' || input === null) return DEFAULT_PROJECT_ALERT_CONFIG
  const data = input as Record<string, unknown>
  const cooldown = Number(data.cooldown_minutes ?? ALERT_LIMITS.DEFAULT_COOLDOWN_MINUTES)
  if (!Number.isFinite(cooldown)) throw new Error('Cooldown must be a number.')
  return {
    enabled: data.enabled === true,
    cooldown_minutes: Math.min(ALERT_LIMITS.MAX_COOLDOWN_MINUTES, Math.max(ALERT_LIMITS.MIN_COOLDOWN_MINUTES, Math.floor(cooldown))),
    notify_recovery: data.notify_recovery === undefined ? true : data.notify_recovery === true,
    alert_types: normalizeAlertTypeToggles(data.alert_types),
  }
}

export function normalizeEmailChannelConfig(input: unknown): AlertEmailChannelConfig {
  if (typeof input !== 'object' || input === null) return DEFAULT_EMAIL_CHANNEL_CONFIG
  const data = input as Record<string, unknown>
  return {
    recipients: normalizeRecipients(data.recipients ?? []),
    template_variant: 'default',
  }
}

export function getAlertsEnv(env: NodeJS.ProcessEnv = process.env): { resendApiKey: string; emailFrom: string; workerSecret: string } {
  const resendApiKey = env.RESEND_API_KEY
  const emailFrom = env.ALERTS_EMAIL_FROM
  const workerSecret = env.ALERT_WORKER_SECRET
  if (!resendApiKey) throw new Error('RESEND_API_KEY is required to send email alerts.')
  if (!emailFrom) throw new Error('ALERTS_EMAIL_FROM is required to send email alerts.')
  if (!workerSecret) throw new Error('ALERT_WORKER_SECRET is required to run the alert worker.')
  return { resendApiKey, emailFrom, workerSecret }
}

export function getEmailEnv(env: NodeJS.ProcessEnv = process.env): { resendApiKey: string; emailFrom: string } {
  const resendApiKey = env.RESEND_API_KEY
  const emailFrom = env.ALERTS_EMAIL_FROM
  if (!resendApiKey) throw new Error('RESEND_API_KEY is required to send email alerts.')
  if (!emailFrom) throw new Error('ALERTS_EMAIL_FROM is required to send email alerts.')
  return { resendApiKey, emailFrom }
}

export function isAlertChannelType(value: unknown): value is typeof ALERT_CHANNEL_TYPE.EMAIL {
  return value === ALERT_CHANNEL_TYPE.EMAIL
}
