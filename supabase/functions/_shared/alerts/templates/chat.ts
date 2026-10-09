// Slack, Microsoft Teams and Discord incoming webhooks.
import type { AlertMessage } from '../types.ts'

const TONE_EMOJI: Record<AlertMessage['tone'], string> = {
  problem: '🔴',
  warning: '🟠',
  recovery: '🟢',
  info: '🔵',
  maintenance: '🔧',
}

function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildSlackPayload(message: AlertMessage): Record<string, unknown> {
  const title = `${TONE_EMOJI[message.tone]} ${message.title}`
  const blocks: Array<Record<string, unknown>> = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${escapeSlack(title)}*${message.summary ? `\n${escapeSlack(message.summary)}` : ''}` } },
  ]
  if (message.fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: message.fields.slice(0, 10).map((field) => ({ type: 'mrkdwn', text: `*${escapeSlack(field.label)}*\n${escapeSlack(field.value)}` })),
    })
  }
  const buttons: Array<Record<string, unknown>> = []
  if (message.dashboardUrl) buttons.push({ type: 'button', text: { type: 'plain_text', text: message.dashboardLabel }, url: message.dashboardUrl })
  if (message.statusPageUrl) buttons.push({ type: 'button', text: { type: 'plain_text', text: 'Status page' }, url: message.statusPageUrl })
  if (buttons.length > 0) blocks.push({ type: 'actions', elements: buttons })
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `${escapeSlack(message.projectName)} · <!date^${Math.floor(new Date(message.occurredAt).getTime() / 1000)}^{date_short_pretty} {time}|${message.occurredAt}>` }] })
  return {
    text: `${title}${message.summary ? ` — ${message.summary}` : ''}`,
    attachments: [{ color: message.color, blocks }],
  }
}

/** Adaptive Card message, accepted by Teams Workflows webhooks and legacy incoming webhooks. */
export function buildTeamsPayload(message: AlertMessage): Record<string, unknown> {
  const body: Array<Record<string, unknown>> = [
    { type: 'TextBlock', text: `${TONE_EMOJI[message.tone]} ${message.title}`, weight: 'Bolder', size: 'Medium', wrap: true },
  ]
  if (message.summary) body.push({ type: 'TextBlock', text: message.summary, wrap: true, spacing: 'Small' })
  if (message.fields.length > 0) {
    body.push({ type: 'FactSet', facts: message.fields.map((field) => ({ title: field.label, value: field.value })) })
  }
  body.push({ type: 'TextBlock', text: `${message.projectName} · ${new Date(message.occurredAt).toUTCString()}`, isSubtle: true, size: 'Small', wrap: true })
  const actions: Array<Record<string, unknown>> = []
  if (message.dashboardUrl) actions.push({ type: 'Action.OpenUrl', title: message.dashboardLabel, url: message.dashboardUrl })
  if (message.statusPageUrl) actions.push({ type: 'Action.OpenUrl', title: 'Status page', url: message.statusPageUrl })
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body, actions },
      },
    ],
  }
}

export function buildDiscordPayload(message: AlertMessage): Record<string, unknown> {
  return {
    username: 'Upvane',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `${TONE_EMOJI[message.tone]} ${message.title}`.slice(0, 256),
        description: message.summary.slice(0, 4000) || undefined,
        url: message.dashboardUrl ?? undefined,
        color: Number.parseInt(message.color.replace('#', ''), 16),
        fields: message.fields.slice(0, 25).map((field) => ({ name: field.label.slice(0, 256), value: field.value.slice(0, 1024) || '—', inline: field.value.length < 40 })),
        timestamp: message.occurredAt,
        footer: { text: message.projectName },
      },
    ],
  }
}
