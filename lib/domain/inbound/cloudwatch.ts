// Amazon CloudWatch alarms delivered by an SNS topic with an HTTPS subscription. SNS first sends a
// SubscriptionConfirmation (Upvane opens SubscribeURL, only on sns.<region>.amazonaws.com), then Notifications whose
// Message is the alarm JSON. Raw message delivery and EventBridge "CloudWatch Alarm State Change" events also work.
import { asObject, InboundParseError, isObject, text, truncate, type InboundAlert, type InboundPayload } from './types'

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/

/** True only for https://sns.<region>.amazonaws.com/… URLs (no credentials, default port). */
export function isTrustedSnsUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname) && url.port === '' && !url.username && !url.password
  } catch {
    return false
  }
}

/** "arn:aws:cloudwatch:us-east-1:123456789012:alarm:High CPU" → { region, account } */
function arnParts(arn: string): { region: string | null; account: string | null } {
  const parts = arn.split(':')
  return parts.length >= 6 && parts[0] === 'arn' ? { region: parts[3] || null, account: parts[4] || null } : { region: null, account: null }
}

function stateToActivity(state: string): boolean | null {
  switch (state.toUpperCase()) {
    case 'ALARM':
      return true
    case 'OK':
      return false
    case 'INSUFFICIENT_DATA':
      return null
    default:
      throw new InboundParseError(`Unknown alarm state "${truncate(state, 40)}". Expected ALARM, OK or INSUFFICIENT_DATA.`)
  }
}

function dimensionsOf(trigger: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  if (!isObject(trigger)) return labels
  const lists: unknown[] = []
  if (Array.isArray(trigger.Dimensions)) lists.push(...trigger.Dimensions)
  // Metric math alarms: Trigger.Metrics[].MetricStat.Metric.Dimensions
  if (Array.isArray(trigger.Metrics)) {
    for (const metric of trigger.Metrics) {
      const dims = isObject(metric) && isObject(metric.MetricStat) && isObject(metric.MetricStat.Metric) ? metric.MetricStat.Metric.Dimensions : null
      if (Array.isArray(dims)) lists.push(...dims)
    }
  }
  for (const dimension of lists) {
    if (!isObject(dimension)) continue
    const name = text(dimension.name ?? dimension.Name)
    const value = text(dimension.value ?? dimension.Value)
    if (name && !(name in labels)) labels[name.slice(0, 100)] = value.slice(0, 500)
  }
  return labels
}

function alarmFromClassic(alarm: Record<string, unknown>): InboundAlert | null {
  const name = text(alarm.AlarmName)
  const state = text(alarm.NewStateValue)
  if (!name || !state) throw new InboundParseError('The CloudWatch alarm has no AlarmName or NewStateValue.')
  const active = stateToActivity(state)
  if (active === null) return null
  const trigger = isObject(alarm.Trigger) ? alarm.Trigger : {}
  const arn = text(alarm.AlarmArn)
  const { region, account } = arnParts(arn)
  const labels: Record<string, string> = {
    ...dimensionsOf(trigger),
    alarm_name: name,
  }
  if (text(trigger.Namespace)) labels.namespace = text(trigger.Namespace)
  if (text(trigger.MetricName)) labels.metric_name = text(trigger.MetricName)
  if (region) labels.region = region
  if (account || text(alarm.AWSAccountId)) labels.account_id = account || text(alarm.AWSAccountId)
  const description = text(alarm.AlarmDescription)
  return {
    external_id: truncate(arn || `${text(alarm.AWSAccountId)}:${name}`, 300),
    active,
    labels,
    summary: truncate(description && description.length <= 200 ? description : name, 500),
    severity: null,
  }
}

function alarmFromEventBridge(event: Record<string, unknown>): InboundAlert | null {
  const detail = asObject(event.detail, 'The EventBridge event has no detail.')
  const name = text(detail.alarmName)
  const state = isObject(detail.state) ? text(detail.state.value) : ''
  if (!name || !state) throw new InboundParseError('The EventBridge event has no alarmName or state.')
  const active = stateToActivity(state)
  if (active === null) return null
  const arn = Array.isArray(event.resources) ? text(event.resources[0]) : ''
  const labels: Record<string, string> = { alarm_name: name }
  const configuration = isObject(detail.configuration) ? detail.configuration : {}
  if (Array.isArray(configuration.metrics)) {
    for (const metric of configuration.metrics) {
      const inner = isObject(metric) && isObject(metric.metricStat) && isObject(metric.metricStat.metric) ? metric.metricStat.metric : null
      if (!inner) continue
      if (isObject(inner.dimensions)) for (const [key, value] of Object.entries(inner.dimensions)) if (!(key in labels)) labels[key] = text(value)
      if (text(inner.namespace) && !labels.namespace) labels.namespace = text(inner.namespace)
      if (text(inner.name) && !labels.metric_name) labels.metric_name = text(inner.name)
    }
  }
  if (text(event.region)) labels.region = text(event.region)
  if (text(event.account)) labels.account_id = text(event.account)
  const description = text(configuration.description)
  return {
    external_id: truncate(arn || `${text(event.account)}:${name}`, 300),
    active,
    labels,
    summary: truncate(description && description.length <= 200 ? description : name, 500),
    severity: null,
  }
}

function parseAlarm(message: Record<string, unknown>): InboundPayload {
  const alert = message['detail-type'] === 'CloudWatch Alarm State Change' ? alarmFromEventBridge(message) : alarmFromClassic(message)
  return alert ? { kind: 'alerts', alerts: [alert], ignored: 0 } : { kind: 'alerts', alerts: [], ignored: 1 }
}

export function parseCloudWatch(body: unknown): InboundPayload {
  const root = asObject(body, 'The payload must be an SNS message (JSON object).')
  const type = text(root.Type)
  if (type === 'SubscriptionConfirmation') {
    const subscribeUrl = text(root.SubscribeURL)
    if (!subscribeUrl) throw new InboundParseError('The subscription confirmation has no SubscribeURL.')
    return { kind: 'subscription_confirmation', subscribeUrl, topicArn: text(root.TopicArn) || null }
  }
  if (type === 'UnsubscribeConfirmation') return { kind: 'ignored', reason: 'The SNS topic unsubscribed this URL.' }
  if (type === 'Notification') {
    let message: unknown
    try {
      message = JSON.parse(text(root.Message))
    } catch {
      throw new InboundParseError('The SNS message is not a CloudWatch alarm: Message is not JSON.')
    }
    return parseAlarm(asObject(message, 'The SNS message is not a CloudWatch alarm.'))
  }
  // Raw message delivery (no SNS envelope) or an EventBridge event.
  if ('AlarmName' in root || root['detail-type'] === 'CloudWatch Alarm State Change') return parseAlarm(root)
  throw new InboundParseError('This is not an SNS notification from CloudWatch. Subscribe this URL to the SNS topic of your alarms (protocol HTTPS).')
}
