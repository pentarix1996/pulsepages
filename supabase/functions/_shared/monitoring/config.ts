// Defaults and descriptions for monitor configs. Validation of user input lives in lib/domain/schemas.ts (zod);
// the probe only relies on these defaults.
import type { MonitorType } from '../domain.ts'
import type { DnsMonitorConfig, HttpMonitorConfig, TcpMonitorConfig, TlsMonitorConfig } from './types.ts'

export const MONITOR_DEFAULTS = {
  interval_seconds: 180,
  timeout_ms: 10_000,
  confirm_failures: 2,
  confirm_regions: 1,
  recovery_successes: 2,
  heartbeat_grace_seconds: 300,
  tls_warn_days: 14,
  max_redirects: 5,
} as const

export function httpConfig(config: Record<string, unknown>): Required<Pick<HttpMonitorConfig, 'url' | 'method' | 'follow_redirects'>> & HttpMonitorConfig {
  return {
    ...(config as unknown as HttpMonitorConfig),
    url: String(config.url ?? ''),
    method: (typeof config.method === 'string' ? config.method.toUpperCase() : 'GET') as HttpMonitorConfig['method'] & string,
    follow_redirects: config.follow_redirects !== false,
    headers: Array.isArray(config.headers) ? (config.headers as HttpMonitorConfig['headers']) : [],
    assertions: Array.isArray(config.assertions) ? (config.assertions as HttpMonitorConfig['assertions']) : [],
  } as Required<Pick<HttpMonitorConfig, 'url' | 'method' | 'follow_redirects'>> & HttpMonitorConfig
}

export function tcpConfig(config: Record<string, unknown>): TcpMonitorConfig {
  return { host: String(config.host ?? ''), port: Number(config.port ?? 0), latency_threshold_ms: typeof config.latency_threshold_ms === 'number' ? config.latency_threshold_ms : null }
}

export function dnsConfig(config: Record<string, unknown>): Required<Pick<DnsMonitorConfig, 'hostname' | 'record_type' | 'match'>> & DnsMonitorConfig {
  return {
    hostname: String(config.hostname ?? ''),
    record_type: (typeof config.record_type === 'string' ? config.record_type.toUpperCase() : 'A') as DnsMonitorConfig['record_type'] & string,
    expected_values: Array.isArray(config.expected_values) ? config.expected_values.map(String) : [],
    match: config.match === 'all' ? 'all' : 'any',
  } as Required<Pick<DnsMonitorConfig, 'hostname' | 'record_type' | 'match'>> & DnsMonitorConfig
}

export function tlsConfig(config: Record<string, unknown>): Required<TlsMonitorConfig> {
  return {
    hostname: String(config.hostname ?? ''),
    port: Number(config.port ?? 443) || 443,
    warn_days: Number(config.warn_days ?? config.tls_warn_days ?? MONITOR_DEFAULTS.tls_warn_days) || MONITOR_DEFAULTS.tls_warn_days,
  }
}

/** Same text as SQL monitor_target(): what the monitor points at. */
export function describeTarget(type: MonitorType, config: Record<string, unknown>): string {
  switch (type) {
    case 'http':
      return `${String(config.method ?? 'GET').toUpperCase()} ${String(config.url ?? '')}`
    case 'keyword':
      return String(config.url ?? '')
    case 'tcp':
      return `${String(config.host ?? '')}:${String(config.port ?? '')}`
    case 'dns':
      return `${String(config.record_type ?? 'A').toUpperCase()} ${String(config.hostname ?? '')}`
    case 'tls':
      return `${String(config.hostname ?? '')}:${String(config.port ?? 443)}`
    default:
      return 'Heartbeat'
  }
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  if (seconds % 3600 === 0) return `${seconds / 3600} h`
  if (seconds % 60 === 0) return `${seconds / 60} min`
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}
