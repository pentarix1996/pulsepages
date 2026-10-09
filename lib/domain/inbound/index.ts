// Entry point of the inbound alert parsers: one parser per integration type.
import type { InboundIntegrationType } from '@shared/domain.ts'
import { parseAlertmanager, parseGrafana } from './alertmanager'
import { parseCloudWatch } from './cloudwatch'
import { parseDatadog } from './datadog'
import { parseGeneric } from './generic'
import type { InboundPayload } from './types'

export { DATADOG_PAYLOAD_TEMPLATE } from './datadog'
export { isTrustedSnsUrl } from './cloudwatch'
export { mapAlertsToSignals, severityToStatus, type ComponentRef, type MappingConfig, type MappingRule, type SignalInput } from './mapping'
export { InboundParseError, type InboundAlert, type InboundPayload } from './types'

const PARSERS: Record<InboundIntegrationType, (body: unknown) => InboundPayload> = {
  alertmanager: parseAlertmanager,
  grafana: parseGrafana,
  datadog: parseDatadog,
  cloudwatch: parseCloudWatch,
  generic: parseGeneric,
}

/** Parses a provider payload (already JSON-decoded). Throws InboundParseError with a readable message. */
export function parseInboundPayload(type: InboundIntegrationType, body: unknown): InboundPayload {
  return PARSERS[type](body)
}
