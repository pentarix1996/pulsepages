// Turns a routing rule into one readable line:
// "Component changes and monitor alerts → Team email, #ops-alerts · every component · cooldown 15 min".
import { ALERT_EVENT_GROUPS, ROUTABLE_EVENT_TYPES, type AlertEventType, type ProblemStatus } from '@shared/domain.ts'

const GROUP_WORDS: Record<string, { noun: string; all: string }> = {
  Components: { noun: 'components', all: 'component changes' },
  Monitors: { noun: 'monitors', all: 'monitor alerts' },
  Incidents: { noun: 'incidents', all: 'incidents and drafts' },
  Maintenance: { noun: 'maintenance', all: 'maintenance' },
}

const SHORT: Partial<Record<AlertEventType, string>> = {
  component_status_worsened: 'got worse',
  component_recovered: 'recovered',
  monitor_down: 'down',
  monitor_degraded: 'degraded',
  monitor_recovered: 'recovered',
  tls_expiring: 'certificate expiring',
  incident_draft_created: 'drafts',
  incident_created: 'new',
  incident_updated: 'updated',
  incident_resolved: 'resolved',
  maintenance_scheduled: 'scheduled',
  maintenance_started: 'started',
  maintenance_completed: 'completed',
  maintenance_cancelled: 'cancelled',
}

const MIN_STATUS_TEXT: Record<ProblemStatus, string> = {
  degraded: 'degraded or worse',
  partial_outage: 'partial outage or worse',
  major_outage: 'major outages only',
}

export function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text
}

/** "Incidents (new, updated, resolved) and maintenance (started, completed)". */
export function describeEvents(types: readonly string[]): string {
  const selected = new Set(types)
  if (ROUTABLE_EVENT_TYPES.every((type) => selected.has(type))) return 'Every event'
  const phrases: string[] = []
  for (const group of ALERT_EVENT_GROUPS) {
    const words = GROUP_WORDS[group.label] ?? { noun: group.label.toLowerCase(), all: group.label.toLowerCase() }
    const present = group.types.filter((type) => selected.has(type))
    if (present.length === 0) continue
    if (present.length === group.types.length) phrases.push(words.all)
    else phrases.push(`${words.noun} (${present.map((type) => SHORT[type] ?? type).join(', ')})`)
  }
  return phrases.length > 0 ? capitalize(joinWords(phrases)) : 'No events'
}

export function describeCooldown(minutes: number): string {
  if (minutes <= 0) return 'no cooldown'
  if (minutes < 60) return `cooldown ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `cooldown ${hours} h ${rest} min` : `cooldown ${hours} h`
}

function namesOf(ids: readonly string[], lookup: Map<string, string>, max: number): string {
  const names = ids.map((id) => lookup.get(id) ?? 'deleted item')
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ')
}

export interface RuleLike {
  event_types: readonly string[]
  channel_ids: readonly string[]
  component_ids: readonly string[]
  monitor_ids: readonly string[]
  min_status: ProblemStatus | null
  cooldown_minutes: number
}

export interface RuleSentence {
  events: string
  channels: string
  details: string[]
  /** Problems worth flagging next to the rule. */
  warnings: string[]
}

export function describeRule(
  rule: RuleLike,
  lookups: { channels: Map<string, { name: string; enabled: boolean }>; components: Map<string, string>; monitors: Map<string, string> },
): RuleSentence {
  const channelNames = rule.channel_ids.map((id) => {
    const channel = lookups.channels.get(id)
    if (!channel) return 'deleted channel'
    return channel.enabled ? channel.name : `${channel.name} (off)`
  })
  const warnings: string[] = []
  if (rule.channel_ids.length === 0) warnings.push('No channel: matching events are not sent anywhere.')
  else if (rule.channel_ids.every((id) => !lookups.channels.get(id)?.enabled)) warnings.push('Every channel of this rule is off.')

  const details = [rule.component_ids.length === 0 ? 'every component' : namesOf(rule.component_ids, lookups.components, 2)]
  if (rule.monitor_ids.length > 0) details.push(`monitors: ${namesOf(rule.monitor_ids, lookups.monitors, 2)}`)
  if (rule.min_status) details.push(MIN_STATUS_TEXT[rule.min_status])
  details.push(describeCooldown(rule.cooldown_minutes))

  return {
    events: describeEvents(rule.event_types),
    channels: channelNames.length > 0 ? channelNames.join(', ') : 'no channel',
    details,
    warnings,
  }
}

export function ruleSentenceText(sentence: RuleSentence): string {
  return `${sentence.events} → ${sentence.channels} · ${sentence.details.join(' · ')}`
}
