// Datadog webhooks integration. Datadog sends whatever JSON template the admin pastes, so Upvane documents one:
// DATADOG_PAYLOAD_TEMPLATE below. Triggered, Re-Triggered and Warn fire; Recovered resolves; No Data is ignored.
import { asObject, checkAlertCount, InboundParseError, isObject, labelValue, text, truncate, type InboundAlert, type InboundPayload } from './types'

/** Payload to paste in Datadog → Integrations → Webhooks (Datadog replaces the $VARIABLES). */
export const DATADOG_PAYLOAD_TEMPLATE = `{
  "id": "$ALERT_ID",
  "scope": "$ALERT_SCOPE",
  "transition": "$ALERT_TRANSITION",
  "title": "$EVENT_TITLE",
  "tags": "$TAGS",
  "priority": "$PRIORITY",
  "link": "$LINK"
}`

const FIRING = new Set(['triggered', 're-triggered', 'retriggered', 'renotify', 'alert', 'error'])
const WARNING = new Set(['warn', 'warning', 're-warn', 'rewarn', 're-warning'])
const RESOLVED = new Set(['recovered', 'ok', 'resolved', 'success'])
const NO_DATA = new Set(['no data', 'no_data', 'nodata', 're-no data', 're-nodata', 're-no_data'])

/** "env:prod,service:api,critical" → { env: "prod", service: "api", critical: "" }. Values may contain colons. */
export function parseDatadogTags(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  const raw = Array.isArray(value) ? value.map(text).join(',') : text(value)
  for (const part of raw.split(',')) {
    const tag = part.trim()
    if (!tag || tag === '*') continue
    const colon = tag.indexOf(':')
    const key = (colon === -1 ? tag : tag.slice(0, colon)).trim().slice(0, 100)
    const val = colon === -1 ? '' : tag.slice(colon + 1).trim().slice(0, 500)
    if (key && !(key in labels)) labels[key] = val
    if (Object.keys(labels).length >= 100) break
  }
  return labels
}

/** "[Triggered on {host:web-1}] High CPU on web-1" → "High CPU on web-1". */
function cleanTitle(title: string): string {
  return title.replace(/^\s*\[[^\]]*\]\s*/, '').trim()
}

function parseOne(item: unknown, index: number | null): InboundAlert | null {
  const where = index === null ? 'The payload' : `Item ${index}`
  const event = asObject(item, `${where} must be a JSON object. Use the payload template from the integration settings.`)
  const id = text(event.id ?? event.alert_id)
  if (!id || id.startsWith('$')) {
    throw new InboundParseError(`${where} has no "id". Use the payload template from the integration settings ("id": "$ALERT_ID").`)
  }
  const transitionRaw = text(event.transition ?? event.alert_transition)
  const transition = transitionRaw.toLowerCase()
  if (!transition || transition.startsWith('$')) {
    throw new InboundParseError(`${where} has no "transition". Use the payload template from the integration settings ("transition": "$ALERT_TRANSITION").`)
  }
  if (NO_DATA.has(transition)) return null
  const warning = WARNING.has(transition)
  if (!FIRING.has(transition) && !warning && !RESOLVED.has(transition)) {
    throw new InboundParseError(`Unknown Datadog transition "${truncate(transitionRaw, 40)}". Expected Triggered, Re-Triggered, Warn or Recovered.`)
  }

  const scope = text(event.scope)
  const labels = { ...parseDatadogTags(scope.startsWith('$') ? '' : scope), ...parseDatadogTags(event.tags) }
  if (isObject(event.labels)) {
    for (const [key, value] of Object.entries(event.labels)) if (typeof value === 'string') labels[key] = value
  }
  labels.alert_id = id
  const priority = text(event.priority).toLowerCase()
  if (priority && !priority.startsWith('$')) labels.priority = priority
  const title = cleanTitle(text(event.title ?? event.event_title))

  return {
    external_id: truncate(scope && scope !== '*' && !scope.startsWith('$') ? `${id}:${scope}` : id, 300),
    active: !RESOLVED.has(transition),
    labels,
    summary: title ? truncate(title, 500) : null,
    severity: warning ? 'warning' : labelValue(labels, 'severity') ?? labels.priority ?? null,
  }
}

export function parseDatadog(body: unknown): InboundPayload {
  const items = Array.isArray(body) ? body : [body]
  checkAlertCount(items.length)
  const alerts: InboundAlert[] = []
  let ignored = 0
  items.forEach((item, index) => {
    const alert = parseOne(item, Array.isArray(body) ? index : null)
    if (alert) alerts.push(alert)
    else ignored += 1
  })
  return { kind: 'alerts', alerts, ignored }
}
