// Where alerts may be sent. Chat providers are pinned to their official webhook hosts; generic webhooks must be public
// https URLs (SSRF rules from monitoring/ssrf.ts), checked on save and again before every delivery.
import { validateMonitorUrl } from '../monitoring/ssrf.ts'
import type { TargetValidation } from '../monitoring/ssrf.ts'

const CHAT_HOSTS: Record<'slack' | 'teams' | 'discord', RegExp[]> = {
  slack: [/^hooks\.slack\.com$/],
  discord: [/^(discord|discordapp)\.com$/, /^(canary|ptb)\.discord\.com$/],
  teams: [/\.webhook\.office\.com$/, /^outlook\.office\.com$/, /\.logic\.azure\.com$/, /\.powerplatform\.com$/, /\.powerautomate\.com$/],
}

const CHAT_PATHS: Record<'slack' | 'teams' | 'discord', RegExp | null> = {
  slack: /^\/services\//,
  discord: /^\/api\/webhooks\//,
  teams: null,
}

export function validateChatWebhookUrl(type: 'slack' | 'teams' | 'discord', raw: string): TargetValidation {
  const base = validateMonitorUrl(raw)
  if (!base.ok) return base
  const url = new URL(base.url!)
  if (!CHAT_HOSTS[type].some((pattern) => pattern.test(url.hostname))) {
    const examples = { slack: 'https://hooks.slack.com/services/…', discord: 'https://discord.com/api/webhooks/…', teams: 'a Teams Workflows or incoming webhook URL' }
    return { ok: false, reason: `That is not a ${type === 'teams' ? 'Microsoft Teams' : type === 'slack' ? 'Slack' : 'Discord'} webhook URL. Expected ${examples[type]}.` }
  }
  const path = CHAT_PATHS[type]
  if (path && !path.test(url.pathname)) return { ok: false, reason: 'The webhook URL looks incomplete. Copy it again from the app.' }
  return base
}

export function validateWebhookUrl(raw: string): TargetValidation {
  return validateMonitorUrl(raw)
}

export const ROUTING_KEY_PATTERN = /^[a-zA-Z0-9]{32}$/
export const OPSGENIE_KEY_PATTERN = /^[a-f0-9-]{36}$/i
