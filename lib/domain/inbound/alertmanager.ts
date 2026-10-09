// Prometheus Alertmanager webhook (version 4) and the Grafana unified alerting webhook, which uses the same family
// of payload: { status, alerts: [{ status: firing|resolved, labels, annotations, fingerprint, … }], … }.
import { asObject, checkAlertCount, InboundParseError, labelsId, labelValue, text, toLabels, truncate, type InboundAlert, type InboundPayload } from './types'

interface FamilyOptions {
  /** Name shown in error messages. */
  provider: string
  /** Extra summary text for an alert (Grafana values). */
  extraSummary?: (alert: Record<string, unknown>) => string | null
}

function parseFamily(body: unknown, options: FamilyOptions): InboundPayload {
  const root = asObject(body, `The payload must be a JSON object from ${options.provider}.`)
  if (!Array.isArray(root.alerts)) {
    throw new InboundParseError(`The payload has no alerts list. Point a ${options.provider} webhook at this URL.`)
  }
  checkAlertCount(root.alerts.length)
  const groupStatus = text(root.status).toLowerCase()
  const alerts: InboundAlert[] = root.alerts.map((item, index) => {
    const alert = asObject(item, `alerts[${index}] is not an object.`)
    const status = (text(alert.status) || groupStatus).toLowerCase()
    if (status !== 'firing' && status !== 'resolved') {
      throw new InboundParseError(`alerts[${index}].status must be firing or resolved (got ${JSON.stringify(text(alert.status) || null)}).`)
    }
    const labels = toLabels(alert.labels)
    const annotations = toLabels(alert.annotations)
    const base = labelValue(annotations, 'summary') || labelValue(annotations, 'description') || labelValue(labels, 'alertname') || null
    const extra = options.extraSummary?.(alert) ?? null
    const summary = base && extra ? `${base} (${extra})` : base ?? extra
    return {
      external_id: truncate(text(alert.fingerprint), 300) || labelsId(labels),
      active: status === 'firing',
      labels,
      summary: summary ? truncate(summary, 500) : null,
      severity: labelValue(labels, 'severity') ?? labelValue(labels, 'priority') ?? null,
    }
  })
  return { kind: 'alerts', alerts, ignored: 0 }
}

export function parseAlertmanager(body: unknown): InboundPayload {
  return parseFamily(body, { provider: 'Prometheus Alertmanager' })
}

/**
 * Grafana `values` ({ "A": 812.4, "B": 1 }) as "A=812.4, B=1". Older versions only send valueString
 * ("[ var='A' labels={…} value=812.4 ], …"), which is read the same way.
 */
function grafanaValues(alert: Record<string, unknown>): string | null {
  const values = alert.values
  let parts: string[] = []
  if (typeof values === 'object' && values !== null && !Array.isArray(values)) {
    parts = Object.entries(values as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
      .map(([key, value]) => `${key}=${typeof value === 'number' ? Number(value.toFixed(3)) : value}`)
  } else if (typeof alert.valueString === 'string') {
    parts = [...alert.valueString.matchAll(/var='([^']+)'[^\]]*?value=([^\s\]]+)/g)].map((match) => `${match[1]}=${match[2]}`)
  }
  return parts.length > 0 ? parts.slice(0, 4).join(', ') : null
}

export function parseGrafana(body: unknown): InboundPayload {
  const root = asObject(body, 'The payload must be a JSON object from Grafana Alerting.')
  if (!Array.isArray(root.alerts) && ('ruleId' in root || 'evalMatches' in root)) {
    throw new InboundParseError('This is a legacy Grafana alert. Use a Grafana Alerting contact point of type Webhook.')
  }
  return parseFamily(root, { provider: 'Grafana Alerting', extraSummary: grafanaValues })
}
