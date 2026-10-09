import 'server-only'
import { lookup } from 'node:dns/promises'
import {
  alertStatusRank,
  CHECK_RESULT_STATUSES,
  hasRole,
  MONITOR_STATES,
  type AlertChannelType,
  type CheckResultStatus,
  type ComponentStatus,
  type MonitorState,
  type MonitorType,
  type ProblemStatus,
} from '@shared/domain.ts'
import { decryptJson, encryptJson } from '@shared/crypto.ts'
import { validateMonitorUrlWithDns, validateResolvedHost, type DnsResolver } from '@shared/monitoring/ssrf.ts'
import type { HeaderPair } from '@shared/monitoring/types.ts'
import { isPlan, PLAN_INFO } from '@shared/plans.ts'
import { env } from '@/lib/env'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import { invalidateStatusPage } from './cache'
import { actorUserId, type DomainContext } from './context'
import { conflict, DomainError, fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import { heartbeatUrl } from './heartbeats'
import { decodeCursor, keysetFilter, toPage, type Page, type PageRequest } from './pagination'
import {
  MONITOR_CONFIG_SCHEMAS,
  type CheckResultResource,
  type MonitorComponentRef,
  type MonitorCreateInput,
  type MonitorResource,
  type MonitorRunResource,
  type MonitorUpdateInput,
  type ProbeResultResource,
  type SecretHeaderInput,
} from './schemas/monitors'
import type { AlertRuleRow, MonitorCheckResultRow, MonitorRegionStateRow, MonitorRow } from './types'

// Monitors (spec §5, api.md "Monitors"). Plan limits, config shape, state and managed fields are enforced by
// monitors_before_write(); this module validates input, resolves components, encrypts secret headers (written with
// the admin client after the admin check, monitor_secrets has no client policies) and shapes API resources.

const MONITOR_COLUMNS =
  'id, project_id, name, type, enabled, paused_reason, interval_seconds, timeout_ms, regions, confirm_failures, confirm_regions, recovery_successes, config, failure_status, degraded_status, state, state_changed_at, last_checked_at, next_check_at, last_result, last_error, heartbeat_token, last_heartbeat_at, tls_expires_at, tls_checked_at, auto_draft_incident, legacy_config_id, created_by, created_at, updated_at'

const HTTP_TYPES: readonly MonitorType[] = ['http', 'keyword']

export function isHttpType(type: MonitorType): boolean {
  return HTTP_TYPES.includes(type)
}

// ------------------------------------------------------------------ resources
export interface MonitorExtras {
  components: MonitorComponentRef[]
  secretHeaderNames: string[]
  /** Admins (and write keys) see the heartbeat URL, which contains the secret token. */
  showSecrets: boolean
}

export function toMonitorResource(row: MonitorRow, extras: MonitorExtras): MonitorResource {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    paused_reason: row.paused_reason,
    interval_seconds: row.interval_seconds,
    timeout_ms: row.timeout_ms,
    regions: row.regions,
    confirm_failures: row.confirm_failures,
    confirm_regions: row.confirm_regions,
    recovery_successes: row.recovery_successes,
    config: row.config as unknown as MonitorResource['config'],
    secret_header_names: extras.secretHeaderNames,
    failure_status: row.failure_status,
    degraded_status: row.degraded_status,
    auto_draft_incident: row.auto_draft_incident,
    components: extras.components,
    state: row.state,
    state_changed_at: row.state_changed_at,
    last_checked_at: row.last_checked_at,
    last_result: row.last_result,
    last_error: row.last_error,
    tls_expires_at: row.tls_expires_at,
    last_heartbeat_at: row.last_heartbeat_at,
    heartbeat_url: row.type === 'heartbeat' && row.heartbeat_token && extras.showSecrets ? heartbeatUrl(row.heartbeat_token) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function touchStatusPage(access: ProjectAccess): void {
  invalidateStatusPage(access.organization.slug, access.project.slug)
}

async function loadComponentLinks(ctx: DomainContext, monitorIds: string[]): Promise<Map<string, MonitorComponentRef[]>> {
  const map = new Map<string, MonitorComponentRef[]>()
  if (monitorIds.length === 0) return map
  const rows = unwrap(await ctx.db.from('monitor_components').select('monitor_id, component:components(id, slug, name, position)').in('monitor_id', monitorIds)) as unknown as Array<{
    monitor_id: string
    component: { id: string; slug: string; name: string; position: number } | null
  }>
  const sorted = rows.filter((row) => row.component).sort((a, b) => a.component!.position - b.component!.position || a.component!.name.localeCompare(b.component!.name))
  for (const row of sorted) {
    const list = map.get(row.monitor_id) ?? []
    list.push({ component_id: row.component!.id, slug: row.component!.slug, name: row.component!.name })
    map.set(row.monitor_id, list)
  }
  return map
}

/** Header names only. Callers pass ids of monitors already read through ctx.db (access was checked). */
async function loadSecretNames(ctx: DomainContext, monitorIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (monitorIds.length === 0) return map
  const { data, error } = await ctx.admin().from('monitor_secrets').select('monitor_id, header_names').in('monitor_id', monitorIds)
  if (error) throw fromDatabaseError(error)
  for (const row of (data ?? []) as Array<{ monitor_id: string; header_names: string[] | null }>) map.set(row.monitor_id, row.header_names ?? [])
  return map
}

async function toResources(ctx: DomainContext, access: ProjectAccess, rows: MonitorRow[]): Promise<MonitorResource[]> {
  const ids = rows.map((row) => row.id)
  const [links, secrets] = await Promise.all([loadComponentLinks(ctx, ids), loadSecretNames(ctx, ids)])
  const showSecrets = hasRole(access.role, 'admin')
  return rows.map((row) => toMonitorResource(row, { components: links.get(row.id) ?? [], secretHeaderNames: secrets.get(row.id) ?? [], showSecrets }))
}

async function resolveMonitor(ctx: DomainContext, projectId: string, monitorRef: string): Promise<MonitorRow> {
  if (!isUuid(monitorRef)) throw notFound('Monitor')
  return unwrapOne(await ctx.db.from('monitors').select(MONITOR_COLUMNS).eq('project_id', projectId).eq('id', monitorRef.toLowerCase()).maybeSingle(), 'Monitor') as MonitorRow
}

async function readMonitor(ctx: DomainContext, access: ProjectAccess, monitorId: string): Promise<MonitorResource> {
  const row = await resolveMonitor(ctx, access.project.id, monitorId)
  return (await toResources(ctx, access, [row]))[0]!
}

// ------------------------------------------------------------------ validation helpers
const DNS_TIMEOUT_MS = 4000

/** node:dns lookup of every A/AAAA address, with a timeout (the save request must not hang on slow DNS). */
export const resolveWithNodeDns: DnsResolver = async (hostname) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const entries = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS)
      }),
    ])
    return entries.map((entry) => entry.address)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Parses a config for `type` with the same schema as create; errors carry `config.<field>` paths. */
export function parseMonitorConfig(type: MonitorType, raw: unknown): Record<string, unknown> {
  const parsed = MONITOR_CONFIG_SCHEMAS[type].safeParse(raw)
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({ path: ['config', ...issue.path].map(String).join('.'), message: issue.message }))
    throw invalid(`${details[0]!.path}: ${details[0]!.message}`, details)
  }
  return parsed.data as Record<string, unknown>
}

function targetError(path: string, reason: string): DomainError {
  return invalid(reason, [{ path, message: reason }])
}

/**
 * SSRF checks that need DNS (spec §5): HTTP URLs and TCP/TLS hosts must resolve only to public addresses. DNS monitors
 * only query records (the probe never connects to the answer), so their hostname rules are checked by the schema.
 */
export async function validateMonitorTarget(type: MonitorType, config: Record<string, unknown>, resolve: DnsResolver = resolveWithNodeDns): Promise<void> {
  if (type === 'http' || type === 'keyword') {
    const result = await validateMonitorUrlWithDns(String(config.url ?? ''), resolve)
    if (!result.ok) throw targetError('config.url', result.reason)
  } else if (type === 'tcp' || type === 'tls') {
    const field = type === 'tcp' ? 'host' : 'hostname'
    const result = await validateResolvedHost(String(config[field] ?? ''), resolve)
    if (!result.ok) throw targetError(`config.${field}`, result.reason)
  }
}

/** The database raises "Your free plan …"; show the plan name and how to get more. */
function monitorWriteError(error: Parameters<typeof fromDatabaseError>[0]): DomainError {
  const domain = fromDatabaseError(error, 'Monitor')
  if (domain.code !== 'plan_limit') return domain
  let message = domain.message.replace(/\byour (free|pro|business) plan\b/i, (_, plan: string) => `Your ${isPlan(plan.toLowerCase()) ? PLAN_INFO[plan.toLowerCase() as keyof typeof PLAN_INFO].name : plan} plan`)
  if (/checks every/i.test(message)) message += ' Upgrade to check more often.'
  else if (/region/i.test(message)) message += ' Upgrade to check from more regions.'
  return new DomainError('plan_limit', message)
}

async function resolveComponentIds(ctx: DomainContext, projectId: string, refs: string[]): Promise<string[]> {
  const unique = [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))]
  if (unique.length === 0) return []
  const rows = unwrap(await ctx.db.from('components').select('id, slug').eq('project_id', projectId)) as Array<{ id: string; slug: string }>
  const ids = new Set<string>()
  unique.forEach((ref, index) => {
    const match = rows.find((row) => row.id === ref.toLowerCase() || row.slug === ref.toLowerCase())
    if (!match) throw invalid(`Component ${ref} was not found in this status page.`, [{ path: `components.${index}`, message: 'This component does not exist.' }])
    ids.add(match.id)
  })
  return [...ids]
}

async function replaceMonitorComponents(ctx: DomainContext, monitorId: string, componentIds: string[]): Promise<void> {
  const current = (unwrap(await ctx.db.from('monitor_components').select('component_id').eq('monitor_id', monitorId)) as Array<{ component_id: string }>).map((row) => row.component_id)
  const removed = current.filter((id) => !componentIds.includes(id))
  const added = componentIds.filter((id) => !current.includes(id))
  if (removed.length > 0) unwrap(await ctx.db.from('monitor_components').delete().eq('monitor_id', monitorId).in('component_id', removed))
  if (added.length > 0) unwrap(await ctx.db.from('monitor_components').insert(added.map((componentId) => ({ monitor_id: monitorId, component_id: componentId }))))
}

// ------------------------------------------------------------------ secret headers
function secretsKey(): string {
  try {
    return env.secretsKey()
  } catch {
    throw new DomainError('unavailable', 'Secret headers cannot be saved: set UPVANE_SECRETS_KEY on the server.')
  }
}

/** Decrypted saved headers of a monitor (empty when none). Only after an admin check. */
async function readSavedSecrets(ctx: DomainContext, monitorId: string): Promise<HeaderPair[] | 'unreadable'> {
  const { data, error } = await ctx.admin().from('monitor_secrets').select('headers_encrypted').eq('monitor_id', monitorId).maybeSingle()
  if (error) throw fromDatabaseError(error)
  const encrypted = (data as { headers_encrypted: string } | null)?.headers_encrypted
  if (!encrypted) return []
  try {
    return await decryptJson<HeaderPair[]>(encrypted, secretsKey())
  } catch (cause) {
    if (cause instanceof DomainError) throw cause
    return 'unreadable'
  }
}

/** Final set of secret headers: `value: null` keeps the saved value of a header with that name. */
export function mergeSecretHeaders(input: SecretHeaderInput[], saved: HeaderPair[] | 'unreadable'): HeaderPair[] {
  const seen = new Set<string>()
  return input.map((header, index) => {
    const key = header.name.toLowerCase()
    if (seen.has(key)) throw invalid(`${header.name} is set twice.`, [{ path: `secret_headers.${index}.name`, message: `${header.name} is set twice.` }])
    seen.add(key)
    if (header.value !== null) return { name: header.name, value: header.value }
    const previous = saved === 'unreadable' ? undefined : saved.find((item) => item.name.toLowerCase() === key)
    if (!previous) {
      const message = saved === 'unreadable' ? `The saved value of ${header.name} cannot be read anymore. Enter it again.` : `Enter a value for the secret header ${header.name}.`
      throw invalid(message, [{ path: `secret_headers.${index}.value`, message }])
    }
    return { name: header.name, value: previous.value }
  })
}

function checkHeaderConflicts(config: Record<string, unknown>, secretNames: string[]): void {
  const plain = Array.isArray(config.headers) ? (config.headers as HeaderPair[]).map((header) => header.name.toLowerCase()) : []
  const clash = secretNames.find((name) => plain.includes(name.toLowerCase()))
  if (clash) throw invalid(`${clash} is both a plain and a secret header. Keep one.`, [{ path: 'secret_headers', message: `${clash} is also a plain header.` }])
}

async function writeSecrets(ctx: DomainContext, monitorId: string, headers: HeaderPair[]): Promise<void> {
  const admin = ctx.admin()
  if (headers.length === 0) {
    const { error } = await admin.from('monitor_secrets').delete().eq('monitor_id', monitorId)
    if (error) throw fromDatabaseError(error)
    return
  }
  const headersEncrypted = await encryptJson(headers, secretsKey())
  const { error } = await admin
    .from('monitor_secrets')
    .upsert({ monitor_id: monitorId, headers_encrypted: headersEncrypted, header_names: headers.map((header) => header.name), updated_at: new Date().toISOString() }, { onConflict: 'monitor_id' })
  if (error) throw fromDatabaseError(error)
}

// ------------------------------------------------------------------ reads
export interface MonitorFilters {
  state?: MonitorState[]
  type?: MonitorType[]
  search?: string
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export async function listMonitors(ctx: DomainContext, projectRef: string, filters: MonitorFilters = {}, page: PageRequest = { limit: 50, cursor: null }): Promise<{ access: ProjectAccess; page: Page<MonitorResource> }> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  let query = ctx.db.from('monitors').select(MONITOR_COLUMNS).eq('project_id', access.project.id)
  if (filters.state && filters.state.length > 0) query = query.in('state', filters.state)
  if (filters.type && filters.type.length > 0) query = query.in('type', filters.type)
  if (filters.search) query = query.ilike('name', `%${escapeLike(filters.search)}%`)
  if (page.cursor) query = query.or(keysetFilter('created_at', page.cursor))
  const rows = unwrap(await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(page.limit + 1)) as MonitorRow[]
  const result = toPage(rows, page, (row) => row.created_at)
  return { access, page: { items: await toResources(ctx, access, result.items), nextCursor: result.nextCursor } }
}

/** Every monitor of a project that matches the filters (plans cap monitors at 100 per organization). */
export async function listAllMonitors(ctx: DomainContext, projectRef: string, filters: MonitorFilters = {}): Promise<{ access: ProjectAccess; monitors: MonitorResource[] }> {
  let request: PageRequest = { limit: 100, cursor: null }
  const monitors: MonitorResource[] = []
  let access: ProjectAccess | null = null
  for (let i = 0; i < 20; i++) {
    const { access: pageAccess, page } = await listMonitors(ctx, access?.project.id ?? projectRef, filters, request)
    access = pageAccess
    monitors.push(...page.items)
    if (!page.nextCursor) break
    request = { limit: 100, cursor: decodeCursor(page.nextCursor) }
  }
  return { access: access!, monitors }
}

export async function getMonitor(ctx: DomainContext, projectRef: string, monitorRef: string): Promise<MonitorResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return readMonitor(ctx, access, monitorRef)
}

export async function getMonitorWithAccess(ctx: DomainContext, projectRef: string, monitorRef: string): Promise<{ access: ProjectAccess; monitor: MonitorResource }> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return { access, monitor: await readMonitor(ctx, access, monitorRef) }
}

// ------------------------------------------------------------------ writes
function definedOnly(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

export async function createMonitor(ctx: DomainContext, projectRef: string, input: MonitorCreateInput, resolve: DnsResolver = resolveWithNodeDns): Promise<MonitorResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const projectId = access.project.id
  const config = input.config as Record<string, unknown>

  let secrets: HeaderPair[] = []
  if (input.secret_headers && input.secret_headers.length > 0) {
    if (!isHttpType(input.type)) throw invalid('Secret headers only apply to HTTP and keyword monitors.', [{ path: 'secret_headers', message: 'Only HTTP and keyword monitors send headers.' }])
    secrets = mergeSecretHeaders(input.secret_headers, [])
    checkHeaderConflicts(config, secrets.map((header) => header.name))
    secretsKey()
  }
  await validateMonitorTarget(input.type, config, resolve)
  const componentIds = input.components ? await resolveComponentIds(ctx, projectId, input.components) : []

  const { data, error } = await ctx.db
    .from('monitors')
    .insert(
      definedOnly({
        project_id: projectId,
        name: input.name,
        type: input.type,
        enabled: input.enabled,
        interval_seconds: input.interval_seconds,
        timeout_ms: input.timeout_ms,
        regions: input.regions,
        confirm_failures: input.confirm_failures,
        confirm_regions: input.confirm_regions,
        recovery_successes: input.recovery_successes,
        failure_status: input.failure_status,
        degraded_status: input.degraded_status,
        auto_draft_incident: input.auto_draft_incident,
        config,
        created_by: actorUserId(ctx),
      }),
    )
    .select(MONITOR_COLUMNS)
    .single()
  if (error) throw monitorWriteError(error)
  const row = data as MonitorRow

  try {
    if (componentIds.length > 0) await replaceMonitorComponents(ctx, row.id, componentIds)
    if (secrets.length > 0) await writeSecrets(ctx, row.id, secrets)
  } catch (cause) {
    await ctx.db.from('monitors').delete().eq('id', row.id)
    throw cause
  }

  await audit(ctx, {
    organizationId: access.organization.id,
    projectId,
    action: 'monitor.created',
    targetType: 'monitor',
    targetId: row.id,
    metadata: { name: row.name, type: row.type, components: componentIds.length, secret_headers: secrets.map((header) => header.name) },
  })
  touchStatusPage(access)
  return readMonitor(ctx, access, row.id)
}

export async function updateMonitor(ctx: DomainContext, projectRef: string, monitorRef: string, input: MonitorUpdateInput, resolve: DnsResolver = resolveWithNodeDns): Promise<MonitorResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const projectId = access.project.id
  const current = await resolveMonitor(ctx, projectId, monitorRef)
  const type = input.type ?? current.type

  if (type !== current.type) {
    if (type === 'heartbeat' || current.type === 'heartbeat') {
      throw invalid('Heartbeat monitors cannot change type, and other monitors cannot become heartbeats. Create a new monitor instead.', [{ path: 'type', message: 'Create a new monitor for this type.' }])
    }
    if (input.config === undefined) throw invalid(`Send the ${type} config to change the type.`, [{ path: 'config', message: 'Required when the type changes.' }])
  }

  const patch: Record<string, unknown> = definedOnly({
    name: input.name,
    enabled: input.enabled,
    interval_seconds: input.interval_seconds,
    timeout_ms: input.timeout_ms,
    regions: input.regions,
    confirm_failures: input.confirm_failures,
    confirm_regions: input.confirm_regions,
    recovery_successes: input.recovery_successes,
    failure_status: input.failure_status,
    degraded_status: input.degraded_status,
    auto_draft_incident: input.auto_draft_incident,
  })
  let config: Record<string, unknown> | null = null
  if (input.config !== undefined) {
    config = parseMonitorConfig(type, input.config)
    patch.config = config
    if (type !== current.type) patch.type = type
  }
  const finalConfig = config ?? current.config

  // Secret headers: undefined keeps them; null or [] removes them; a list replaces them (value null keeps one).
  let secrets: HeaderPair[] | undefined
  if (input.secret_headers !== undefined) {
    if (input.secret_headers === null || input.secret_headers.length === 0) {
      secrets = []
    } else {
      if (!isHttpType(type)) throw invalid('Secret headers only apply to HTTP and keyword monitors.', [{ path: 'secret_headers', message: 'Only HTTP and keyword monitors send headers.' }])
      const needsSaved = input.secret_headers.some((header) => header.value === null)
      secrets = mergeSecretHeaders(input.secret_headers, needsSaved ? await readSavedSecrets(ctx, current.id) : [])
      secretsKey()
    }
  } else if (!isHttpType(type) && isHttpType(current.type)) {
    secrets = []
  }
  if (isHttpType(type) && (config || secrets)) {
    const names = secrets ? secrets.map((header) => header.name) : (await loadSecretNames(ctx, [current.id])).get(current.id) ?? []
    checkHeaderConflicts(finalConfig, names)
  }
  if (config) await validateMonitorTarget(type, config, resolve)
  const componentIds = input.components !== undefined ? await resolveComponentIds(ctx, projectId, input.components) : undefined

  if (Object.keys(patch).length > 0) {
    const { error } = await ctx.db.from('monitors').update(patch).eq('id', current.id).eq('project_id', projectId)
    if (error) throw monitorWriteError(error)
  }
  if (componentIds) await replaceMonitorComponents(ctx, current.id, componentIds)
  if (secrets) await writeSecrets(ctx, current.id, secrets)

  const changes = [...Object.keys(patch), ...(componentIds ? ['components'] : []), ...(secrets ? ['secret_headers'] : [])]
  if (changes.length > 0) {
    const onlyEnabled = changes.length === 1 && changes[0] === 'enabled'
    await audit(ctx, {
      organizationId: access.organization.id,
      projectId,
      action: onlyEnabled ? (input.enabled ? 'monitor.resumed' : 'monitor.paused') : 'monitor.updated',
      targetType: 'monitor',
      targetId: current.id,
      metadata: { name: current.name, changes, ...(secrets ? { secret_headers: secrets.map((header) => header.name) } : {}) },
    })
    touchStatusPage(access)
  }
  return readMonitor(ctx, access, current.id)
}

export async function setMonitorEnabled(ctx: DomainContext, projectRef: string, monitorRef: string, enabled: boolean): Promise<MonitorResource> {
  return updateMonitor(ctx, projectRef, monitorRef, { enabled })
}

export async function deleteMonitor(ctx: DomainContext, projectRef: string, monitorRef: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await resolveMonitor(ctx, access.project.id, monitorRef)
  const deleted = unwrap(await ctx.db.from('monitors').delete().eq('id', current.id).eq('project_id', access.project.id).select('id')) as Array<{ id: string }>
  if (deleted.length === 0) throw notFound('Monitor')
  await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'monitor.deleted', targetType: 'monitor', targetId: current.id, metadata: { name: current.name, type: current.type } })
  touchStatusPage(access)
}

// ------------------------------------------------------------------ run now
function normalizeProbeResult(value: unknown): ProbeResultResource | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.region !== 'string') return null
  const status = (CHECK_RESULT_STATUSES as readonly string[]).includes(String(item.status)) ? (item.status as CheckResultStatus) : 'error'
  return {
    region: item.region,
    status,
    latency_ms: typeof item.latency_ms === 'number' ? Math.round(item.latency_ms) : null,
    http_status: typeof item.http_status === 'number' ? item.http_status : null,
    error: typeof item.error === 'string' ? item.error : null,
    checked_at: typeof item.checked_at === 'string' ? item.checked_at : new Date().toISOString(),
    tls_expires_at: typeof item.tls_expires_at === 'string' ? item.tls_expires_at : null,
    ...(item.details && typeof item.details === 'object' && !Array.isArray(item.details) ? { details: item.details as Record<string, unknown> } : {}),
  }
}

/**
 * Runs the monitor now through the monitor-runner Edge Function (responder and up). Contract: 200 { state, results },
 * 409 when it ran seconds ago, 404 when unknown.
 */
export async function runMonitorNow(ctx: DomainContext, projectRef: string, monitorRef: string, fetcher: typeof fetch = fetch): Promise<MonitorRunResource> {
  const access = await requireProject(ctx, projectRef, 'responder')
  const current = await resolveMonitor(ctx, access.project.id, monitorRef)
  if (current.type === 'heartbeat') throw invalid('Heartbeat monitors run when your job pings them. Call the ping URL to test it.')
  const secret = env.monitorRunnerSecret()
  if (!secret) throw new DomainError('unavailable', 'Checks cannot run from here: set MONITOR_RUNNER_SECRET.')

  let response: Response
  try {
    response = await fetcher(`${env.supabaseUrl()}/functions/v1/monitor-runner`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ monitor_id: current.id }),
      signal: AbortSignal.timeout(Math.min(55_000, current.timeout_ms + 20_000)),
      cache: 'no-store',
    })
  } catch (cause) {
    const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    throw new DomainError('unavailable', timedOut ? 'The check is taking too long to answer. It may still finish; refresh in a moment.' : 'The check runner is not reachable. Try again in a moment.')
  }
  const payload = (await response.json().catch(() => null)) as { state?: unknown; results?: unknown; error?: unknown; code?: unknown } | null
  const message = typeof payload?.error === 'string' && payload.error.trim() ? payload.error.trim() : null
  const reason = typeof payload?.code === 'string' && /^[A-Z_a-z]{2,40}$/.test(payload.code) ? `HTTP ${response.status}, ${payload.code}` : `HTTP ${response.status}`
  if (response.status === 409) throw conflict(message ?? 'This monitor ran a few seconds ago. Wait a moment and run it again.')
  if (response.status === 404) throw notFound('Monitor')
  if (response.status === 401 || response.status === 403) {
    throw new DomainError('unavailable', 'The check runner rejected the request. Check that MONITOR_RUNNER_SECRET matches the Edge Function secret.')
  }
  if (!response.ok || !payload || !Array.isArray(payload.results)) {
    throw new DomainError('unavailable', `The check runner could not run this monitor (${reason}). Try again in a moment.`)
  }
  const state = (MONITOR_STATES as readonly string[]).includes(String(payload.state)) ? (payload.state as MonitorState) : null
  const results = payload.results.map(normalizeProbeResult).filter((item): item is ProbeResultResource => item !== null)

  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'monitor.run',
    targetType: 'monitor',
    targetId: current.id,
    metadata: { name: current.name, state, results: results.map((result) => ({ region: result.region, status: result.status })) },
  })
  return { state, results }
}

// ------------------------------------------------------------------ check results
export function toCheckResultResource(row: Pick<MonitorCheckResultRow, 'id' | 'region' | 'status' | 'http_status' | 'response_time_ms' | 'error_message' | 'details' | 'checked_at'>): CheckResultResource {
  const status: CheckResultStatus = row.status === 'success' ? 'up' : row.status === 'failure' ? 'down' : row.status
  return {
    id: row.id,
    region: row.region,
    status,
    http_status: row.http_status,
    latency_ms: row.response_time_ms,
    error: row.error_message,
    details: row.details,
    checked_at: row.checked_at,
  }
}

export interface ResultFilters {
  region?: string
  status?: 'up' | 'degraded' | 'down' | 'error'
}

const RESULT_COLUMNS = 'id, region, status, http_status, response_time_ms, error_message, details, checked_at'

async function queryResults(ctx: DomainContext, access: ProjectAccess, monitorId: string, filters: ResultFilters, page: PageRequest): Promise<Page<CheckResultResource>> {
  let query = ctx.db.from('monitor_check_results').select(RESULT_COLUMNS).eq('project_id', access.project.id).eq('monitor_id', monitorId)
  if (filters.region) query = query.eq('region', filters.region)
  if (filters.status === 'up') query = query.in('status', ['up', 'success'])
  else if (filters.status === 'down') query = query.in('status', ['down', 'failure'])
  else if (filters.status) query = query.eq('status', filters.status)
  if (page.cursor) query = query.or(keysetFilter('checked_at', page.cursor))
  const rows = unwrap(await query.order('checked_at', { ascending: false }).order('id', { ascending: false }).limit(page.limit + 1)) as MonitorCheckResultRow[]
  const result = toPage(rows, page, (row) => row.checked_at)
  return { items: result.items.map(toCheckResultResource), nextCursor: result.nextCursor }
}

export async function listMonitorResults(ctx: DomainContext, projectRef: string, monitorRef: string, filters: ResultFilters = {}, page: PageRequest = { limit: 50, cursor: null }): Promise<Page<CheckResultResource>> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const monitor = await resolveMonitor(ctx, access.project.id, monitorRef)
  return queryResults(ctx, access, monitor.id, filters, page)
}

// ------------------------------------------------------------------ panel statistics
export interface MonitorSummary {
  checks: number
  failing: number
  degraded: number
  availability: number | null
  avg_latency_ms: number | null
  p95_latency_ms: number | null
  latency_buckets: Array<number | null>
}

/** 24-hour availability and hourly latency per monitor (SQL monitor_summaries). Empty when the function is missing. */
export async function getMonitorSummaries(ctx: DomainContext, projectId: string, hours = 24, buckets = 24): Promise<Record<string, MonitorSummary>> {
  const { data, error } = await ctx.db.rpc('monitor_summaries', { p_project_id: projectId, p_hours: hours, p_buckets: buckets })
  if (error) {
    console.error('[monitors] monitor_summaries failed', error.message)
    return {}
  }
  const map: Record<string, MonitorSummary> = {}
  for (const row of (data ?? []) as Array<MonitorSummary & { monitor_id: string; availability: number | string | null }>) {
    map[row.monitor_id] = {
      checks: row.checks,
      failing: row.failing,
      degraded: row.degraded,
      availability: row.availability === null ? null : Number(row.availability),
      avg_latency_ms: row.avg_latency_ms,
      p95_latency_ms: row.p95_latency_ms,
      latency_buckets: row.latency_buckets ?? [],
    }
  }
  return map
}

export interface LatencyBucket {
  region: string
  bucket: number
  bucket_start: string
  checks: number
  failing: number
  degraded: number
  errors: number
  avg_latency_ms: number | null
  p50_latency_ms: number | null
  p95_latency_ms: number | null
}

export async function getLatencySeries(ctx: DomainContext, monitorId: string, from: Date, to: Date, buckets: number): Promise<LatencyBucket[]> {
  const { data, error } = await ctx.db.rpc('monitor_latency_series', { p_monitor_id: monitorId, p_from: from.toISOString(), p_to: to.toISOString(), p_buckets: buckets })
  if (error) {
    console.error('[monitors] monitor_latency_series failed', error.message)
    return []
  }
  return (data ?? []) as LatencyBucket[]
}

export async function listRegionStates(ctx: DomainContext, monitorIds: string[]): Promise<Record<string, MonitorRegionStateRow[]>> {
  const map: Record<string, MonitorRegionStateRow[]> = {}
  if (monitorIds.length === 0) return map
  const rows = unwrap(await ctx.db.from('monitor_region_state').select('*').in('monitor_id', monitorIds)) as MonitorRegionStateRow[]
  for (const row of rows) (map[row.monitor_id] ??= []).push(row)
  return map
}

// ------------------------------------------------------------------ alert routing (read-only summary)
export interface RoutedChannel {
  id: string
  name: string
  type: AlertChannelType
  enabled: boolean
}

export interface RoutingRow {
  event: 'monitor_down' | 'monitor_degraded' | 'monitor_recovered' | 'tls_expiring'
  /** Severity the event carries (component status), or operational for recoveries. */
  severity: ProblemStatus | 'operational'
  channels: RoutedChannel[]
  rules: Array<{ id: string; name: string; cooldown_minutes: number }>
}

export interface AlertRoutingSummary {
  alertsEnabled: boolean
  muteDuringMaintenance: boolean
  rows: RoutingRow[]
  lastEvent: { id: string; type: string; status: string; suppression_reason: string | null; created_at: string; deliveries: Array<{ target_type: string; status: string }> } | null
}

/** Rules that route this monitor's events (same matching as enqueue_alert_event_and_dispatch). */
export function matchRoutingRules(rules: AlertRuleRow[], monitor: Pick<MonitorResource, 'id' | 'type' | 'failure_status' | 'degraded_status' | 'components'>): Array<{ event: RoutingRow['event']; severity: RoutingRow['severity']; rules: AlertRuleRow[] }> {
  const componentIds = monitor.components.map((component) => component.component_id)
  const events: Array<{ event: RoutingRow['event']; severity: RoutingRow['severity'] }> = [
    { event: 'monitor_down', severity: monitor.failure_status },
    { event: 'monitor_degraded', severity: monitor.degraded_status },
    { event: 'monitor_recovered', severity: 'operational' },
  ]
  if (monitor.type === 'tls') events.push({ event: 'tls_expiring', severity: 'degraded' })
  return events.map(({ event, severity }) => ({
    event,
    severity,
    rules: rules
      .filter((rule) => rule.enabled && rule.event_types.includes(event))
      .filter((rule) => rule.component_ids.length === 0 || rule.component_ids.some((id) => componentIds.includes(id)))
      .filter((rule) => rule.monitor_ids.length === 0 || rule.monitor_ids.includes(monitor.id))
      .filter((rule) => !rule.min_status || event === 'monitor_recovered' || alertStatusRank(severity) >= alertStatusRank(rule.min_status))
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)),
  }))
}

async function getAlertRouting(ctx: DomainContext, access: ProjectAccess, monitor: MonitorResource): Promise<AlertRoutingSummary> {
  const projectId = access.project.id
  const [rulesResult, channelsResult, configResult, eventResult] = await Promise.all([
    ctx.db.from('alert_rules').select('*').eq('project_id', projectId),
    ctx.db.from('alert_channels').select('id, name, type, enabled').eq('project_id', projectId),
    ctx.db.from('project_alert_configs').select('enabled, mute_during_maintenance').eq('project_id', projectId).maybeSingle(),
    ctx.db
      .from('alert_events')
      .select('id, type, status, suppression_reason, created_at, deliveries:alert_deliveries(target_type, status)')
      .eq('project_id', projectId)
      .eq('monitor_id', monitor.id)
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  const rules = (rulesResult.data ?? []) as AlertRuleRow[]
  const channels = (channelsResult.data ?? []) as RoutedChannel[]
  const config = configResult.data as { enabled: boolean; mute_during_maintenance: boolean } | null
  const lastEvent = ((eventResult.data ?? []) as AlertRoutingSummary['lastEvent'][])[0] ?? null
  return {
    alertsEnabled: config?.enabled ?? true,
    muteDuringMaintenance: config?.mute_during_maintenance ?? true,
    rows: matchRoutingRules(rules, monitor).map(({ event, severity, rules: matched }) => {
      const ids = [...new Set(matched.flatMap((rule) => rule.channel_ids))]
      return {
        event,
        severity,
        rules: matched.map((rule) => ({ id: rule.id, name: rule.name, cooldown_minutes: rule.cooldown_minutes })),
        channels: ids.map((id) => channels.find((channel) => channel.id === id)).filter((channel): channel is RoutedChannel => Boolean(channel)),
      }
    }),
    lastEvent,
  }
}

// ------------------------------------------------------------------ page loaders
export interface MonitorsOverview {
  access: ProjectAccess
  monitors: MonitorResource[]
  /** State counts of every monitor of the project (ignores filters), for the filter bar. */
  counts: Record<MonitorState | 'all', number>
  regionStates: Record<string, MonitorRegionStateRow[]>
  summaries: Record<string, MonitorSummary>
}

export async function getMonitorsOverview(ctx: DomainContext, projectRef: string, filters: MonitorFilters = {}): Promise<MonitorsOverview> {
  const { access, monitors } = await listAllMonitors(ctx, projectRef, filters)
  const [states, regionStates, summaries] = await Promise.all([
    ctx.db.from('monitors').select('state').eq('project_id', access.project.id),
    listRegionStates(ctx, monitors.map((monitor) => monitor.id)),
    getMonitorSummaries(ctx, access.project.id),
  ])
  const counts: MonitorsOverview['counts'] = { all: 0, pending: 0, up: 0, degraded: 0, down: 0, paused: 0 }
  for (const row of (unwrap(states) ?? []) as Array<{ state: MonitorState }>) {
    counts.all += 1
    counts[row.state] = (counts[row.state] ?? 0) + 1
  }
  return { access, monitors, counts, regionStates, summaries }
}

export type ChartRange = '24h' | '7d'

export interface MonitorDetail {
  access: ProjectAccess
  monitor: MonitorResource
  regionStates: MonitorRegionStateRow[]
  /** 24 hours in 48 buckets (region tiles, and the chart when range = 24h). */
  series24h: LatencyBucket[]
  /** The chart series for the selected range. */
  chart: { range: ChartRange; from: string; to: string; buckets: LatencyBucket[] }
  checks: Page<CheckResultResource>
  componentStatuses: Record<string, ComponentStatus>
  routing: AlertRoutingSummary
  projectAutoDraft: boolean
}

export async function getMonitorDetail(
  ctx: DomainContext,
  projectRef: string,
  monitorRef: string,
  options: { range?: ChartRange; checks?: ResultFilters; checksPage?: PageRequest } = {},
): Promise<MonitorDetail> {
  const { access, monitor } = await getMonitorWithAccess(ctx, projectRef, monitorRef)
  const range = options.range === '7d' ? '7d' : '24h'
  const to = new Date()
  const from24 = new Date(to.getTime() - 24 * 3_600_000)
  const fromRange = range === '7d' ? new Date(to.getTime() - 7 * 24 * 3_600_000) : from24
  const componentIds = monitor.components.map((component) => component.component_id)

  const [regionStates, series24h, rangeSeries, checks, statuses, routing] = await Promise.all([
    listRegionStates(ctx, [monitor.id]).then((map) => map[monitor.id] ?? []),
    getLatencySeries(ctx, monitor.id, from24, to, 48),
    range === '7d' ? getLatencySeries(ctx, monitor.id, fromRange, to, 84) : Promise.resolve(null),
    queryResults(ctx, access, monitor.id, options.checks ?? {}, options.checksPage ?? { limit: 25, cursor: null }),
    componentIds.length > 0 ? ctx.db.from('components').select('id, status').in('id', componentIds) : Promise.resolve({ data: [], error: null }),
    getAlertRouting(ctx, access, monitor),
  ])
  const componentStatuses: Record<string, ComponentStatus> = {}
  for (const row of (statuses.data ?? []) as Array<{ id: string; status: ComponentStatus }>) componentStatuses[row.id] = row.status

  return {
    access,
    monitor,
    regionStates,
    series24h,
    chart: { range, from: fromRange.toISOString(), to: to.toISOString(), buckets: rangeSeries ?? series24h },
    checks,
    componentStatuses,
    routing,
    projectAutoDraft: access.project.auto_draft_incidents,
  }
}

export interface MonitorFormData {
  access: ProjectAccess
  monitor: MonitorResource | null
  components: Array<{ id: string; slug: string; name: string }>
}

/** What the create/edit form needs: the monitor (edit) and the project's components. Admins only. */
export async function getMonitorFormData(ctx: DomainContext, projectRef: string, monitorRef?: string): Promise<MonitorFormData> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const [monitor, components] = await Promise.all([
    monitorRef ? readMonitor(ctx, access, monitorRef) : Promise.resolve(null),
    ctx.db.from('components').select('id, slug, name').eq('project_id', access.project.id).order('position').order('name'),
  ])
  return { access, monitor, components: (unwrap(components) ?? []) as MonitorFormData['components'] }
}
