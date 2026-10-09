import 'server-only'
import { validateChatWebhookUrl } from '@shared/alerts/targets.ts'
import { encryptJson, generateToken, randomBase62, secretHint, sha256Hex } from '@shared/crypto.ts'
import { renderSubscriptionConfirmationEmail } from '@shared/emails.ts'
import { validateMonitorUrlWithDns } from '@shared/monitoring/ssrf.ts'
import { formatLimit, PLAN_INFO, planLimit } from '@shared/plans.ts'
import { confirmSubscriptionUrl, subscriberKey, unsubscribeTokenHash } from '@shared/subscribers.ts'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { resolvePublicAddresses } from './alerts'
import { audit } from './audit'
import type { DomainContext } from './context'
import { DomainError, fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import { keysetFilter, toPage, type Page, type PageRequest } from './pagination'
import type { SubscribeOutcome, SubscriberAddResult, SubscriberCounts, SubscriberCreateInput, SubscriberListQuery, SubscriberResource } from './schemas/subscribers'
import type { SubscriberRow } from './types'

const SUBSCRIBER_COLUMNS = 'id, project_id, type, email, target_hint, component_ids, confirmed_at, last_notified_at, created_at'

export function toSubscriberResource(row: SubscriberRow): SubscriberResource {
  return {
    id: row.id,
    type: row.type,
    email: row.email,
    target_hint: row.target_hint,
    component_ids: row.component_ids ?? [],
    confirmed: row.confirmed_at !== null,
    confirmed_at: row.confirmed_at,
    last_notified_at: row.last_notified_at,
    created_at: row.created_at,
  }
}

function fieldError(path: string, message: string): DomainError {
  return invalid(message, [{ path, message }])
}

/** Keeps search input inside what a PostgREST `or` filter can carry safely. */
function searchPattern(q: string | undefined): string | null {
  const cleaned = (q ?? '').toLowerCase().replace(/[^a-z0-9@._+-]/g, '').slice(0, 100)
  return cleaned ? `*${cleaned}*` : null
}

export type SubscriberFilters = Pick<SubscriberListQuery, 'type' | 'status' | 'component' | 'q'>

/** Subscribers hold personal data: only admins (and write-scoped API keys) can read them, as in RLS. */
export async function listSubscribers(ctx: DomainContext, projectRef: string, page: PageRequest, filters: SubscriberFilters = {}): Promise<Page<SubscriberResource>> {
  const access = await requireProject(ctx, projectRef, 'admin')
  let query = ctx.db.from('status_page_subscribers').select(SUBSCRIBER_COLUMNS).eq('project_id', access.project.id)
  if (filters.type) query = query.eq('type', filters.type)
  if (filters.status === 'confirmed') query = query.not('confirmed_at', 'is', null)
  if (filters.status === 'pending') query = query.is('confirmed_at', null)
  if (filters.component) query = query.contains('component_ids', [filters.component])
  const pattern = searchPattern(filters.q)
  if (pattern) query = query.or(`email.ilike.${pattern},target_hint.ilike.${pattern}`)
  if (page.cursor) query = query.or(keysetFilter('created_at', page.cursor))
  const rows = unwrap(await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(page.limit + 1)) as SubscriberRow[]
  const result = toPage(rows, page, (row) => row.created_at)
  return { items: result.items.map(toSubscriberResource), nextCursor: result.nextCursor }
}

export async function countSubscribers(ctx: DomainContext, projectRef: string): Promise<SubscriberCounts> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const base = () => ctx.db.from('status_page_subscribers').select('id', { count: 'exact', head: true }).eq('project_id', access.project.id)
  const results = await Promise.all([base(), base().not('confirmed_at', 'is', null), base().eq('type', 'email'), base().eq('type', 'slack'), base().eq('type', 'webhook')])
  const [total, confirmed, emailCount, slack, webhook] = results.map((result) => {
    if (result.error) throw fromDatabaseError(result.error)
    return result.count ?? 0
  }) as [number, number, number, number, number]
  return { total, confirmed, pending: total - confirmed, email: emailCount, slack, webhook, limit: planLimit(access.organization.plan, 'subscribers_per_project') }
}

async function checkComponents(ctx: DomainContext, projectId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  const rows = unwrap(await ctx.db.from('components').select('id').eq('project_id', projectId).in('id', unique)) as Array<{ id: string }>
  const known = new Set(rows.map((row) => row.id))
  const missing = unique.find((id) => !known.has(id))
  if (missing) throw fieldError('component_ids', `Component ${missing} was not found in this status page.`)
  return unique
}

function subscriptionError(error: { code?: string; message?: string }, access: ProjectAccess): DomainError {
  if (error.code === 'P0001' && /more subscribers/i.test(error.message ?? '')) {
    const plan = access.organization.plan
    return new DomainError(
      'plan_limit',
      `This status page has reached the ${PLAN_INFO[plan]?.name ?? plan} plan limit of ${formatLimit(planLimit(plan, 'subscribers_per_project'))} subscribers. Upgrade the plan or remove subscribers to add more.`,
    )
  }
  return fromDatabaseError(error, 'Subscriber')
}

/**
 * Adds a subscriber for the team (the public form lives on the status page). Email subscribers still confirm through
 * the email we send; Slack and webhook targets are validated, encrypted and active right away. The database applies
 * the plan limit inside subscribe_to_status_page().
 */
export async function addSubscriber(ctx: DomainContext, projectRef: string, input: SubscriberCreateInput): Promise<SubscriberAddResult & { signing_secret?: string }> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const projectId = access.project.id
  const componentIds = await checkComponents(ctx, projectId, input.component_ids ?? [])
  const secretKey = env.secretsKey()

  let emailAddress: string | null = null
  let targetUrl: string | null = null
  let targetEncrypted: string | null = null
  let targetHint: string | null = null
  let confirmToken: string | null = null
  let generated: string | null = null

  if (input.type === 'email') {
    emailAddress = input.email
    confirmToken = generateToken('')
  } else if (input.type === 'slack') {
    const checked = validateChatWebhookUrl('slack', input.webhook_url)
    if (!checked.ok) throw fieldError('webhook_url', checked.reason)
    targetUrl = checked.url ?? input.webhook_url
    targetEncrypted = await encryptJson({ webhook_url: targetUrl }, secretKey)
    targetHint = secretHint(targetUrl)
  } else {
    const checked = await validateMonitorUrlWithDns(input.url, resolvePublicAddresses)
    if (!checked.ok) throw fieldError('url', checked.reason)
    targetUrl = checked.url ?? input.url
    if (input.generate_signing_secret) generated = `whsec_${randomBase62(32)}`
    targetEncrypted = await encryptJson({ url: targetUrl, signing_secret: generated ?? input.signing_secret ?? null }, secretKey)
    targetHint = secretHint(targetUrl)
  }

  const unsubscribeHash = await unsubscribeTokenHash(secretKey, projectId, subscriberKey({ type: input.type, email: emailAddress, targetUrl }))
  const confirmHash = confirmToken ? await sha256Hex(confirmToken) : null
  const { data, error } = await ctx.admin().rpc('subscribe_to_status_page', {
    p_project_id: projectId,
    p_type: input.type,
    p_email: emailAddress,
    p_target_encrypted: targetEncrypted,
    p_target_hint: targetHint,
    p_component_ids: componentIds,
    p_confirm_token_hash: confirmHash,
    p_unsubscribe_token_hash: unsubscribeHash,
  })
  if (error) throw subscriptionError(error, access)
  const outcome = data as SubscribeOutcome

  let emailSent: boolean | null = null
  if (outcome === 'confirmation_sent' && emailAddress && confirmToken && confirmHash) {
    const rendered = renderSubscriptionConfirmationEmail({
      pageName: access.project.name,
      confirmUrl: confirmSubscriptionUrl(env.appUrl(), confirmToken),
      brandColor: access.project.brand_color,
      logoUrl: access.project.logo_url,
    })
    const sent = await sendEmail({ to: emailAddress, ...rendered, idempotencyKey: `subscription-confirm:${confirmHash.slice(0, 24)}` })
    emailSent = sent.ok
    if (!sent.ok) console.error('[subscribers] confirmation email failed', sent.error)
  }

  let lookup = ctx.db.from('status_page_subscribers').select(SUBSCRIBER_COLUMNS).eq('project_id', projectId)
  lookup = emailAddress ? lookup.eq('email', emailAddress) : lookup.eq('unsubscribe_token_hash', unsubscribeHash)
  const row = unwrapOne(await lookup.maybeSingle(), 'Subscriber') as SubscriberRow

  await audit(ctx, {
    organizationId: access.organization.id,
    projectId,
    action: 'subscriber.added',
    targetType: 'subscriber',
    targetId: row.id,
    metadata: { type: input.type, target: emailAddress ?? targetHint, outcome, components: componentIds.length },
  })
  return {
    subscriber: generated ? { ...toSubscriberResource(row), signing_secret: generated } : toSubscriberResource(row),
    outcome,
    email_sent: emailSent,
  }
}

export async function removeSubscriber(ctx: DomainContext, projectRef: string, subscriberId: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  if (!isUuid(subscriberId)) throw notFound('Subscriber')
  const deleted = unwrap(
    await ctx.db.from('status_page_subscribers').delete().eq('id', subscriberId).eq('project_id', access.project.id).select('id, type, email, target_hint'),
  ) as Array<Pick<SubscriberRow, 'id' | 'type' | 'email' | 'target_hint'>>
  const row = deleted[0]
  if (!row) throw notFound('Subscriber')
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'subscriber.removed',
    targetType: 'subscriber',
    targetId: row.id,
    metadata: { type: row.type, target: row.email ?? row.target_hint },
  })
}

// ------------------------------------------------------------------ CSV export

/**
 * One CSV field (RFC 4180). Values that a spreadsheet would run as a formula (=, +, -, @, tab, carriage return)
 * get a leading apostrophe (OWASP CSV injection guidance); quotes, commas and line breaks are quoted.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text) || text !== text.trim()) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export const SUBSCRIBER_CSV_HEADER = ['id', 'type', 'email', 'target', 'components', 'status', 'subscribed_at', 'confirmed_at', 'last_notified_at'] as const

export function subscribersToCsv(rows: SubscriberRow[], componentNames: Map<string, string>): string {
  return toCsv([
    [...SUBSCRIBER_CSV_HEADER],
    ...rows.map((row) => [
      row.id,
      row.type,
      row.email,
      row.target_hint,
      row.component_ids.length === 0 ? 'All components' : row.component_ids.map((id) => componentNames.get(id) ?? id).join('; '),
      row.confirmed_at ? 'confirmed' : 'pending',
      row.created_at,
      row.confirmed_at,
      row.last_notified_at,
    ]),
  ])
}

const EXPORT_PAGE = 1000

export async function exportSubscribersCsv(ctx: DomainContext, projectRef: string): Promise<{ filename: string; csv: string; count: number }> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const projectId = access.project.id
  const rows: SubscriberRow[] = []
  for (let from = 0; ; from += EXPORT_PAGE) {
    const page = unwrap(
      await ctx.db.from('status_page_subscribers').select(SUBSCRIBER_COLUMNS).eq('project_id', projectId).order('created_at').order('id').range(from, from + EXPORT_PAGE - 1),
    ) as SubscriberRow[]
    rows.push(...page)
    if (page.length < EXPORT_PAGE) break
  }
  const components = unwrap(await ctx.db.from('components').select('id, name').eq('project_id', projectId)) as Array<{ id: string; name: string }>
  const csv = subscribersToCsv(rows, new Map(components.map((component) => [component.id, component.name])))
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId,
    action: 'subscriber.exported',
    targetType: 'project',
    targetId: projectId,
    metadata: { count: rows.length },
  })
  const date = new Date().toISOString().slice(0, 10)
  return { filename: `${access.organization.slug}-${access.project.slug}-subscribers-${date}.csv`, csv, count: rows.length }
}
