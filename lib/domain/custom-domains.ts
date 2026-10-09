import 'server-only'
import * as dns from 'node:dns/promises'
import { planAllows } from '@shared/plans.ts'
import { env } from '@/lib/env'
import { requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import { invalidateStatusPage } from './cache'
import type { DomainContext } from './context'
import { DomainError, invalid, unwrap, unwrapOne } from './errors'
import { DOMAIN_PATTERN, type CustomDomainState, type CustomDomainStatus, type DnsRecordInstruction } from './schemas/status-page'
import type { ProjectRow } from './types'

// ------------------------------------------------------------------ checks (pure, dependencies injected)

export interface DomainDnsResolver {
  resolveCname(hostname: string): Promise<string[]>
  resolve4(hostname: string): Promise<string[]>
}

export interface VercelSettings {
  token: string
  projectId: string
  teamId: string | null
}

export interface DomainCheckDeps {
  dns: DomainDnsResolver
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** Set when VERCEL_API_TOKEN and VERCEL_PROJECT_ID are configured. */
  vercel: VercelSettings | null
  /** Hostname the customer's CNAME must point to (CUSTOM_DOMAIN_CNAME_TARGET). */
  target: string
}

export interface DomainCheck {
  status: Extract<CustomDomainStatus, 'verified' | 'pending' | 'error'>
  message: string | null
  records: DnsRecordInstruction[]
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

export function defaultDomainDeps(): DomainCheckDeps {
  const vercel = env.vercel()
  return {
    dns: { resolveCname: (hostname) => dns.resolveCname(hostname), resolve4: (hostname) => dns.resolve4(hostname) },
    fetch: (input, init) => fetch(input, init),
    vercel: vercel.token && vercel.projectId ? { token: vercel.token, projectId: vercel.projectId, teamId: vercel.teamId } : null,
    target: normalizeHost(env.customDomainTarget()),
  }
}

export function cnameInstruction(domain: string, target: string): DnsRecordInstruction {
  return { type: 'CNAME', name: domain, value: target, purpose: 'Sends visitors of your domain to Upvane' }
}

/** Validates a domain the customer owns. Upvane's own hosts cannot be claimed. */
export function validateCustomDomain(raw: string, reserved: { appHost: string | null; target: string }): string {
  const domain = normalizeHost(raw.replace(/^https?:\/\//i, '').replace(/[/?#].*$/, ''))
  if (!domain || domain.length > 253 || !DOMAIN_PATTERN.test(domain)) {
    throw invalid('Enter a domain such as status.example.com, without https://.', [{ path: 'domain', message: 'Enter a domain such as status.example.com, without https://.' }])
  }
  const ours = [reserved.appHost, reserved.target].filter((host): host is string => Boolean(host)).map(normalizeHost)
  if (ours.some((host) => domain === host || domain.endsWith(`.${host}`)) || domain.endsWith('.vercel.app') || domain.endsWith('.localhost')) {
    throw invalid('That domain belongs to Upvane. Use a domain you own, such as status.example.com.', [{ path: 'domain', message: 'That domain belongs to Upvane.' }])
  }
  return domain
}

function dnsCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'UNKNOWN'
}

const NO_RECORD = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'ENONAME'])

/** Without Vercel: the domain must CNAME to the target (or resolve to the same addresses when the CNAME is flattened). */
export async function checkDomainDns(domain: string, deps: Pick<DomainCheckDeps, 'dns' | 'target'>): Promise<DomainCheck> {
  const target = normalizeHost(deps.target)
  const records = [cnameInstruction(domain, target)]
  const failed = (error: unknown): DomainCheck => ({ status: 'error', message: `The DNS lookup for ${domain} failed (${dnsCode(error)}). Try again in a few minutes.`, records })

  let cnames: string[] = []
  try {
    cnames = (await deps.dns.resolveCname(domain)).map(normalizeHost)
  } catch (error) {
    if (!NO_RECORD.has(dnsCode(error))) return failed(error)
  }
  if (cnames.includes(target)) return { status: 'verified', message: null, records }
  if (cnames.length > 0) {
    return { status: 'error', message: `${domain} points to ${cnames[0]}. Change the CNAME record so it points to ${target}.`, records }
  }

  // Apex domains and providers that flatten CNAMEs answer with A records: compare them with the target's.
  let addresses: string[] = []
  try {
    addresses = await deps.dns.resolve4(domain)
  } catch (error) {
    if (!NO_RECORD.has(dnsCode(error))) return failed(error)
  }
  if (addresses.length === 0) {
    return { status: 'pending', message: `No DNS record for ${domain} yet. Add a CNAME record that points to ${target}. DNS changes can take up to an hour to show up.`, records }
  }
  let targetAddresses: string[] = []
  try {
    targetAddresses = await deps.dns.resolve4(target)
  } catch {
    targetAddresses = []
  }
  if (addresses.some((address) => targetAddresses.includes(address))) return { status: 'verified', message: null, records }
  return {
    status: 'error',
    message: `${domain} resolves to ${addresses.slice(0, 3).join(', ')}, not to Upvane. Replace those records with a CNAME record that points to ${target}.`,
    records,
  }
}

interface VercelResult {
  ok: boolean
  status: number
  data: Record<string, unknown> | null
}

async function vercelCall(deps: DomainCheckDeps, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<VercelResult> {
  const vercel = deps.vercel!
  const url = new URL(`https://api.vercel.com${path}`)
  if (vercel.teamId) url.searchParams.set('teamId', vercel.teamId)
  try {
    const response = await deps.fetch(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${vercel.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return { ok: response.ok, status: response.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

function vercelMessage(result: VercelResult, prefix: string): string {
  const error = result.data?.error as { message?: string } | undefined
  if (error?.message) return `${prefix}: ${error.message}`
  return result.status === 0 ? `${prefix}: Vercel could not be reached. Try again in a few minutes.` : `${prefix} (Vercel answered ${result.status}).`
}

interface VercelProjectDomain {
  verified?: boolean
  verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>
}

function recordType(value: string | undefined): DnsRecordInstruction['type'] {
  return value === 'CNAME' || value === 'A' ? value : 'TXT'
}

/**
 * With Vercel: adds the domain to the Vercel project (POST /v10/projects/{id}/domains) when it is not there yet, reads
 * its ownership verification (GET /v9/projects/{id}/domains/{domain}, retrying POST …/verify) and checks that DNS
 * points to Vercel (GET /v6/domains/{domain}/config).
 */
export async function checkDomainVercel(domain: string, deps: DomainCheckDeps): Promise<DomainCheck> {
  const vercel = deps.vercel!
  const records = [cnameInstruction(domain, normalizeHost(deps.target))]
  const projectPath = `/v9/projects/${encodeURIComponent(vercel.projectId)}/domains/${encodeURIComponent(domain)}`

  let info = await vercelCall(deps, 'GET', projectPath)
  if (info.status === 404) {
    const added = await vercelCall(deps, 'POST', `/v10/projects/${encodeURIComponent(vercel.projectId)}/domains`, { name: domain })
    if (!added.ok) return { status: 'error', message: vercelMessage(added, `Vercel did not accept ${domain}`), records }
    info = await vercelCall(deps, 'GET', projectPath)
  }
  if (!info.ok) return { status: 'error', message: vercelMessage(info, `Could not read ${domain} from Vercel`), records }

  let current = (info.data ?? {}) as VercelProjectDomain
  if (!current.verified) {
    const verify = await vercelCall(deps, 'POST', `${projectPath}/verify`)
    if (verify.ok && (verify.data as VercelProjectDomain | null)?.verified) current = verify.data as VercelProjectDomain
  }
  if (!current.verified) {
    const challenges: DnsRecordInstruction[] = (current.verification ?? [])
      .filter((item) => item.domain && item.value)
      .map((item) => ({ type: recordType(item.type), name: item.domain!, value: item.value!, purpose: 'Proves you own the domain' }))
    const first = challenges[0]
    return {
      status: 'pending',
      message: first
        ? `Add a ${first.type} record named ${first.name} with the value ${first.value} to prove you own ${domain}, then verify again.`
        : `Vercel has not verified ${domain} yet. Try again in a few minutes.`,
      records: [...records, ...challenges],
    }
  }

  const config = await vercelCall(deps, 'GET', `/v6/domains/${encodeURIComponent(domain)}/config`)
  if (config.ok && (config.data as { misconfigured?: boolean } | null)?.misconfigured) {
    return { status: 'pending', message: `${domain} does not point to Upvane yet. Add a CNAME record that points to ${normalizeHost(deps.target)}. DNS changes can take up to an hour to show up.`, records }
  }
  return { status: 'verified', message: null, records }
}

export function checkCustomDomain(domain: string, deps: DomainCheckDeps): Promise<DomainCheck> {
  return deps.vercel ? checkDomainVercel(domain, deps) : checkDomainDns(domain, deps)
}

/** Best effort: a removed or replaced domain stops pointing at this deployment. */
export async function removeDomainFromVercel(domain: string, deps: DomainCheckDeps): Promise<void> {
  if (!deps.vercel) return
  const result = await vercelCall(deps, 'DELETE', `/v9/projects/${encodeURIComponent(deps.vercel.projectId)}/domains/${encodeURIComponent(domain)}`)
  if (!result.ok && result.status !== 404) console.error('[custom-domain] could not remove the domain from Vercel', domain, result.status)
}

// ------------------------------------------------------------------ status page operations

export function customDomainState(project: Pick<ProjectRow, 'custom_domain' | 'custom_domain_status' | 'custom_domain_error' | 'custom_domain_verified_at'>, target: string, records?: DnsRecordInstruction[]): CustomDomainState {
  const domain = project.custom_domain
  return {
    domain,
    status: domain ? project.custom_domain_status : 'none',
    error: project.custom_domain_error,
    verified_at: project.custom_domain_verified_at,
    target: normalizeHost(target),
    records: records ?? (domain ? [cnameInstruction(domain, normalizeHost(target))] : []),
  }
}

function requireCustomDomainPlan(access: ProjectAccess): void {
  if (!planAllows(access.organization.plan, 'custom_domain')) {
    throw new DomainError('plan_required', 'Custom domains require the Pro plan. Upgrade to serve the status page from your own domain.')
  }
}

function appHost(): string | null {
  try {
    return new URL(env.appUrl()).hostname
  } catch {
    return null
  }
}

/** Domain verification fields are managed: projects_guard_settings only lets a privileged session write them. */
async function persistCheck(ctx: DomainContext, access: ProjectAccess, domain: string, check: DomainCheck): Promise<ProjectRow> {
  const keepVerifiedAt = access.project.custom_domain === domain && access.project.custom_domain_status === 'verified' ? access.project.custom_domain_verified_at : null
  const updated = unwrap(
    await ctx
      .admin()
      .from('projects')
      .update({
        custom_domain_status: check.status,
        custom_domain_verified_at: check.status === 'verified' ? keepVerifiedAt ?? new Date().toISOString() : null,
        custom_domain_error: check.message,
      })
      .eq('id', access.project.id)
      .eq('custom_domain', domain)
      .select('*')
      .maybeSingle(),
  ) as ProjectRow | null
  if (updated) return updated
  // The domain changed while we were checking: report the current state.
  return unwrapOne(await ctx.db.from('projects').select('*').eq('id', access.project.id).maybeSingle(), 'Status page') as ProjectRow
}

export interface CustomDomainResult {
  access: ProjectAccess
  project: ProjectRow
  state: CustomDomainState
}

export async function getCustomDomain(ctx: DomainContext, projectRef: string): Promise<CustomDomainState> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return customDomainState(access.project, defaultDomainDeps().target)
}

/** Re-checks the domain (Vercel or DNS) and records the result on the project. */
export async function verifyCustomDomain(ctx: DomainContext, projectRef: string, deps: DomainCheckDeps = defaultDomainDeps()): Promise<CustomDomainResult> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const domain = access.project.custom_domain
  if (!domain) throw invalid('Add a custom domain before verifying it.')
  requireCustomDomainPlan(access)
  const check = await checkCustomDomain(domain, deps)
  const project = await persistCheck(ctx, access, domain, check)
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: check.status === 'verified' ? 'custom_domain.verified' : 'custom_domain.checked',
    targetType: 'project',
    targetId: access.project.id,
    metadata: { domain, status: check.status, error: check.message },
  })
  invalidateStatusPage(access.organization.slug, access.project.slug)
  return { access, project, state: customDomainState(project, deps.target, check.records) }
}

/** Connects, replaces or removes (null) the custom domain, then checks the new one right away. */
export async function setCustomDomain(ctx: DomainContext, projectRef: string, raw: string | null, deps: DomainCheckDeps = defaultDomainDeps()): Promise<CustomDomainResult> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const previous = access.project.custom_domain
  const domain = raw === null ? null : validateCustomDomain(raw, { appHost: appHost(), target: deps.target })
  if (domain !== null) requireCustomDomainPlan(access)
  if (domain === previous) {
    return domain ? verifyCustomDomain(ctx, access.project.id, deps) : { access, project: access.project, state: customDomainState(access.project, deps.target) }
  }

  // RLS and projects_guard_settings apply: plan gate, one project per domain, status reset to pending (or none).
  const updated = unwrapOne(await ctx.db.from('projects').update({ custom_domain: domain }).eq('id', access.project.id).select('*').maybeSingle(), 'Status page') as ProjectRow
  if (previous) await removeDomainFromVercel(previous, deps)
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: domain ? 'custom_domain.updated' : 'custom_domain.removed',
    targetType: 'project',
    targetId: access.project.id,
    metadata: { domain, previous },
  })
  invalidateStatusPage(access.organization.slug, access.project.slug)
  if (!domain) return { access, project: updated, state: customDomainState(updated, deps.target) }

  const nextAccess = { ...access, project: updated }
  const check = await checkCustomDomain(domain, deps)
  const project = await persistCheck(ctx, nextAccess, domain, check)
  if (check.status === 'verified') {
    await audit(ctx, { organizationId: access.organization.id, projectId: access.project.id, action: 'custom_domain.verified', targetType: 'project', targetId: access.project.id, metadata: { domain } })
  }
  return { access: nextAccess, project, state: customDomainState(project, deps.target, check.records) }
}
