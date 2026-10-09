// Pure helpers for the monitor-runner Edge Function: which regions to probe, how to read a probe's answer, the
// payload sent to monitor-probe and how claimed monitors are drained within a time budget. No Deno globals.
import { CHECK_RESULT_STATUSES, MONITOR_TYPES } from '../domain.ts'
import type { CheckResultStatus, MonitorState, MonitorType } from '../domain.ts'
import type { MonitorRunPayload, ProbeRequest, ProbeResult } from './types.ts'

/** monitor-probe gets timeout_ms plus this grace period before the runner gives up on it. */
export const PROBE_GRACE_MS = 5000
export const RUN_NOW_CONFLICT_MESSAGE = 'This monitor ran a few seconds ago. Try again in a moment.'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ERROR_LENGTH = 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export type RunnerCommand = { mode: 'cron' } | { mode: 'monitor'; monitorId: string }

/** `{}` or `{ "source": "cron" }` drains due monitors; `{ "monitor_id": "<uuid>" }` is "Run now". */
export function parseRunnerCommand(body: unknown): { ok: true; command: RunnerCommand } | { ok: false; error: string } {
  if (body === null || body === undefined) return { ok: true, command: { mode: 'cron' } }
  if (!isRecord(body)) return { ok: false, error: 'Send a JSON object.' }
  if (body.monitor_id !== undefined && body.monitor_id !== null) {
    return isUuid(body.monitor_id) ? { ok: true, command: { mode: 'monitor', monitorId: body.monitor_id.toLowerCase() } } : { ok: false, error: 'monitor_id must be a UUID.' }
  }
  return { ok: true, command: { mode: 'cron' } }
}

/** MONITOR_PROBE_REGIONS: optional comma-separated allow-list of regions where a probe can run. */
export function parseRegionAllowList(value: string | null | undefined): string[] | null {
  if (!value) return null
  const regions = [...new Set(value.split(',').map((region) => region.trim().toLowerCase()).filter(Boolean))]
  return regions.length > 0 ? regions : null
}

export function selectProbeRegions(regions: string[], allowList: string[] | null): { probe: string[]; skipped: string[] } {
  const unique = [...new Set(regions)]
  if (!allowList) return { probe: unique, skipped: [] }
  return { probe: unique.filter((region) => allowList.includes(region)), skipped: unique.filter((region) => !allowList.includes(region)) }
}

/** Minimal shape check of a claim_due_monitors() / claim_monitor() row. */
export function parseRunPayload(value: unknown): MonitorRunPayload | null {
  if (!isRecord(value) || !isUuid(value.id) || typeof value.type !== 'string' || !(MONITOR_TYPES as readonly string[]).includes(value.type)) return null
  const regions = Array.isArray(value.regions) ? value.regions.filter((region): region is string => typeof region === 'string' && region !== '') : []
  if (regions.length === 0) return null
  const positive = (input: unknown, fallback: number) => (typeof input === 'number' && Number.isFinite(input) && input > 0 ? Math.round(input) : fallback)
  return {
    id: value.id,
    project_id: typeof value.project_id === 'string' ? value.project_id : '',
    name: typeof value.name === 'string' ? value.name : '',
    type: value.type as MonitorType,
    config: isRecord(value.config) ? value.config : {},
    regions,
    timeout_ms: positive(value.timeout_ms, 10_000),
    interval_seconds: positive(value.interval_seconds, 180),
    confirm_failures: positive(value.confirm_failures, 2),
    confirm_regions: positive(value.confirm_regions, 1),
    recovery_successes: positive(value.recovery_successes, 2),
    state: (typeof value.state === 'string' ? value.state : 'pending') as MonitorState,
    tls_checked_at: typeof value.tls_checked_at === 'string' ? value.tls_checked_at : null,
    secret_headers: typeof value.secret_headers === 'string' && value.secret_headers !== '' ? value.secret_headers : null,
    region_states: isRecord(value.region_states) ? (value.region_states as MonitorRunPayload['region_states']) : {},
  }
}

export function buildProbeRequest(payload: MonitorRunPayload): ProbeRequest {
  return {
    monitor_id: payload.id,
    type: payload.type as ProbeRequest['type'],
    config: payload.config ?? {},
    timeout_ms: payload.timeout_ms,
    secret_headers: payload.secret_headers ?? null,
  }
}

/** A result for a region whose probe could not run or answer: unknown, it never moves the state machine. */
export function errorProbeResult(region: string, message: string, now: Date = new Date(), details?: Record<string, unknown>): ProbeResult {
  return { region, status: 'error', latency_ms: null, http_status: null, error: message.slice(0, MAX_ERROR_LENGTH), checked_at: now.toISOString(), ...(details ? { details } : {}) }
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Validates and cleans a ProbeResult (integers where SQL expects integers). The result is attributed to the region
 * that was asked; if the probe reports another region, it is kept in details.executed_region.
 */
export function normalizeProbeResult(region: string, value: unknown, now: Date = new Date()): ProbeResult | null {
  if (!isRecord(value) || typeof value.status !== 'string' || !(CHECK_RESULT_STATUSES as readonly string[]).includes(value.status)) return null
  const latency = typeof value.latency_ms === 'number' && Number.isFinite(value.latency_ms) && value.latency_ms >= 0 ? Math.round(value.latency_ms) : null
  const httpStatus = typeof value.http_status === 'number' && Number.isInteger(value.http_status) && value.http_status >= 100 && value.http_status <= 599 ? value.http_status : null
  const details: Record<string, unknown> = isRecord(value.details) ? { ...value.details } : {}
  if (typeof value.region === 'string' && value.region !== '' && value.region !== region) details.executed_region = value.region
  const result: ProbeResult = {
    region,
    status: value.status as CheckResultStatus,
    latency_ms: latency,
    http_status: httpStatus,
    error: typeof value.error === 'string' && value.error !== '' ? value.error.slice(0, MAX_ERROR_LENGTH) : null,
    checked_at: isoDate(value.checked_at) ?? now.toISOString(),
  }
  const tls = isoDate(value.tls_expires_at)
  if (tls) result.tls_expires_at = tls
  if (Object.keys(details).length > 0) result.details = details
  return result
}

/** Turns whatever monitor-probe answered (or failed to answer) into exactly one ProbeResult. */
export function readProbeAnswer(region: string, httpStatus: number, body: unknown, now: Date = new Date()): ProbeResult {
  const result = normalizeProbeResult(region, body, now)
  if (httpStatus >= 200 && httpStatus < 300) {
    return result ?? errorProbeResult(region, `The probe in ${region} answered without a valid result.`, now)
  }
  if (result && result.status === 'error') return result
  // Upvane errors use `error`; the Supabase gateway and edge runtime use `message` (BOOT_ERROR, WORKER_LIMIT...).
  const detail = isRecord(body) ? [body.error, body.message].find((value): value is string => typeof value === 'string' && value !== '') : undefined
  const message = detail ? `: ${detail}` : '.'
  return errorProbeResult(region, `The probe in ${region} answered HTTP ${httpStatus}${message}`.slice(0, MAX_ERROR_LENGTH), now)
}

/** Earliest certificate expiry reported by the results (TLS monitors), for record_monitor_run(p_tls_expires_at). */
export function earliestTlsExpiry(results: ProbeResult[]): string | null {
  const dates = results
    .map((result) => isoDate(result.tls_expires_at))
    .filter((value): value is string => value !== null)
    .sort()
  return dates[0] ?? null
}

export interface DrainOptions {
  /** Monitors processed at the same time. */
  concurrency: number
  /** No new claims after this many milliseconds; claimed monitors always finish. */
  budgetMs: number
  now?: () => number
}

export interface DrainStats {
  claimed: number
  processed: number
  batches: number
  budgetExhausted: boolean
  claimError: unknown
}

/**
 * Claims work in batches and processes it with bounded concurrency until a claim returns nothing or the budget is
 * spent. Everything that was claimed is processed, even after the budget runs out (it would otherwise wait a full
 * interval, since claiming already moved next_check_at).
 */
export async function drainWithBudget<T>(claim: () => Promise<T[]>, process: (item: T) => Promise<void>, options: DrainOptions): Promise<DrainStats> {
  const now = options.now ?? (() => Date.now())
  const started = now()
  const queue: T[] = []
  const stats: DrainStats = { claimed: 0, processed: 0, batches: 0, budgetExhausted: false, claimError: null }
  let exhausted = false
  let claiming: Promise<void> | null = null

  const refill = async () => {
    try {
      const batch = await claim()
      stats.batches += 1
      if (batch.length === 0) exhausted = true
      stats.claimed += batch.length
      queue.push(...batch)
    } catch (error) {
      stats.claimError = error
      exhausted = true
    }
  }

  const next = async (): Promise<T | null> => {
    for (;;) {
      if (queue.length > 0) return queue.shift() as T
      if (exhausted) return null
      if (now() - started >= options.budgetMs) {
        stats.budgetExhausted = true
        exhausted = true
        return null
      }
      if (!claiming) claiming = refill().finally(() => (claiming = null))
      await claiming
    }
  }

  const worker = async () => {
    for (;;) {
      const item = await next()
      if (item === null) return
      try {
        await process(item)
      } catch {
        // process() reports its own failures; one monitor never stops the others.
      }
      stats.processed += 1
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, () => worker()))
  return stats
}
