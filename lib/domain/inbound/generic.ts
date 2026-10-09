// Generic JSON: one object or an array of them.
//   { "external_id": "disk-db-1", "status": "degraded", "component": "database", "summary": "Disk 92% full",
//     "labels": { "host": "db-1" } }
// status: degraded | partial_outage | major_outage (fires with that status), operational | resolved | ok (resolves),
// firing | triggered | alerting (fires with the mapped/default status). `active` (boolean) wins over status.
import { PROBLEM_STATUSES, type ProblemStatus } from '@shared/domain.ts'
import { asObject, checkAlertCount, InboundParseError, labelValue, text, toLabels, truncate, type InboundAlert, type InboundPayload } from './types'

const RESOLVING = new Set(['operational', 'resolved', 'ok', 'up', 'recovered', 'inactive', 'closed'])
const FIRING = new Set(['firing', 'triggered', 'alerting', 'active', 'problem', 'down', 'open', 'alarm'])

function parseOne(item: unknown, where: string): InboundAlert {
  const event = asObject(item, `${where} must be a JSON object.`)
  const externalId = text(event.external_id ?? event.id)
  if (!externalId) throw new InboundParseError(`${where} needs an external_id (a stable id for this alert, such as "disk-db-1").`)

  const statusRaw = text(event.status).toLowerCase()
  let status: ProblemStatus | null = null
  let active = true
  if (statusRaw) {
    if ((PROBLEM_STATUSES as readonly string[]).includes(statusRaw)) status = statusRaw as ProblemStatus
    else if (RESOLVING.has(statusRaw)) active = false
    else if (!FIRING.has(statusRaw)) {
      throw new InboundParseError(`${where} has an unknown status "${truncate(statusRaw, 40)}". Use degraded, partial_outage, major_outage or resolved.`)
    }
  }
  if (event.active !== undefined) {
    if (typeof event.active !== 'boolean') throw new InboundParseError(`${where}: active must be true or false.`)
    active = event.active
  }

  const labels = toLabels(event.labels)
  const component = text(event.component ?? event.component_id)
  const summary = text(event.summary ?? event.title ?? event.message)
  return {
    external_id: truncate(externalId, 300),
    active,
    labels,
    summary: summary ? truncate(summary, 500) : null,
    severity: text(event.severity) || labelValue(labels, 'severity') || null,
    status,
    component: component || null,
  }
}

export function parseGeneric(body: unknown): InboundPayload {
  if (Array.isArray(body)) {
    checkAlertCount(body.length)
    return { kind: 'alerts', alerts: body.map((item, index) => parseOne(item, `Item ${index}`)), ignored: 0 }
  }
  return { kind: 'alerts', alerts: [parseOne(body, 'The payload')], ignored: 0 }
}
