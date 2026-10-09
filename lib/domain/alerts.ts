import 'server-only'
import { resolve4, resolve6 } from 'node:dns/promises'
import { buildAlertMessage } from '@shared/alerts/message.ts'
import { OPSGENIE_KEY_PATTERN, ROUTING_KEY_PATTERN, validateChatWebhookUrl } from '@shared/alerts/targets.ts'
import type { AlertPayload } from '@shared/alerts/types.ts'
import { decryptJson, encryptJson, generateToken, randomBase62, secretHint, sha256Hex } from '@shared/crypto.ts'
import { ALERT_CHANNEL_LABELS, type AlertChannelType, type DeliveryStatus } from '@shared/domain.ts'
import { renderRecipientVerificationEmail } from '@shared/emails.ts'
import { validateMonitorUrlWithDns } from '@shared/monitoring/ssrf.ts'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuid, requireProject, type ProjectAccess } from './access'
import { audit } from './audit'
import { actorUserId, type DomainContext } from './context'
import { conflict, DomainError, fromDatabaseError, invalid, notFound, unwrap, unwrapOne } from './errors'
import { keysetFilter, toPage, type Page, type PageRequest } from './pagination'
import {
  MAX_RECIPIENTS,
  RECIPIENT_RESEND_MINUTES,
  TEST_ALERTS_PER_WINDOW,
  TEST_WINDOW_MINUTES,
  type AlertChannelCreateInput,
  type AlertChannelResource,
  type AlertChannelSecretInput,
  type AlertChannelUpdateInput,
  type AlertDeliveryResource,
  type AlertEventResource,
  type AlertEventStatusFilter,
  type AlertRecipientResource,
  type AlertRuleCreateInput,
  type AlertRuleReorderInput,
  type AlertRuleResource,
  type AlertRuleUpdateInput,
  type AlertSettingsInput,
  type AlertSettingsResource,
  type AlertTestResult,
} from './schemas/alerts'
import type { AlertChannelRow, AlertDeliveryRow, AlertEventRow, AlertRuleRow } from './types'

// ======================================================================
// Settings (master switch, maintenance mute)
// ======================================================================

async function readSettings(ctx: DomainContext, projectId: string): Promise<AlertSettingsResource> {
  const row = unwrap(await ctx.db.from('project_alert_configs').select('enabled, mute_during_maintenance').eq('project_id', projectId).maybeSingle()) as
    | { enabled: boolean; mute_during_maintenance: boolean }
    | null
  return { enabled: row?.enabled ?? true, mute_during_maintenance: row?.mute_during_maintenance ?? true }
}

export async function getAlertSettings(ctx: DomainContext, projectRef: string): Promise<AlertSettingsResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return readSettings(ctx, access.project.id)
}

export async function updateAlertSettings(ctx: DomainContext, projectRef: string, input: AlertSettingsInput): Promise<AlertSettingsResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await readSettings(ctx, access.project.id)
  const next: AlertSettingsResource = {
    enabled: input.enabled ?? current.enabled,
    mute_during_maintenance: input.mute_during_maintenance ?? current.mute_during_maintenance,
  }
  const changes = (Object.keys(next) as Array<keyof AlertSettingsResource>).filter((key) => next[key] !== current[key])
  if (changes.length === 0) return current
  unwrap(await ctx.db.from('project_alert_configs').upsert({ project_id: access.project.id, ...next }, { onConflict: 'project_id' }))
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'alert_settings.updated',
    targetType: 'project',
    targetId: access.project.id,
    metadata: Object.fromEntries(changes.map((key) => [key, next[key]])),
  })
  return next
}

// ======================================================================
// Channels
// ======================================================================

const CHANNEL_COLUMNS = 'id, project_id, type, name, enabled, config, created_by, created_at, updated_at'
const RECIPIENT_COLUMNS = 'id, channel_id, email, verified_at, verification_sent_at, created_at'

type ChannelRow = Omit<AlertChannelRow, 'legacy_config_id'>

interface RecipientRow {
  id: string
  channel_id: string
  email: string
  verified_at: string | null
  verification_sent_at: string | null
  created_at: string
}

/** Decrypted shape of alert_channel_secrets.secret_encrypted (read by supabase/functions/_shared/alerts/dispatch.ts). */
export interface ChannelSecret {
  webhook_url?: string
  url?: string
  signing_secret?: string | null
  routing_key?: string
  api_key?: string
}

export interface PreparedSecret {
  value: ChannelSecret
  hint: string
  /** A signing secret generated in this request (returned once). */
  generated: string | null
}

const CHAT_TYPES = ['slack', 'teams', 'discord'] as const
type ChatType = (typeof CHAT_TYPES)[number]

const SECRET_KEYS_BY_TYPE: Record<AlertChannelType, Array<keyof AlertChannelSecretInput>> = {
  email: [],
  slack: ['webhook_url'],
  teams: ['webhook_url'],
  discord: ['webhook_url'],
  webhook: ['url', 'signing_secret'],
  pagerduty: ['routing_key'],
  opsgenie: ['api_key'],
}

function isChatType(type: AlertChannelType): type is ChatType {
  return (CHAT_TYPES as readonly string[]).includes(type)
}

function fieldError(path: string, message: string): DomainError {
  return invalid(message, [{ path, message }])
}

/** DNS for webhook targets: every A/AAAA record must be public (SSRF, spec §5). */
export async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  const [v4, v6] = await Promise.allSettled([resolve4(hostname), resolve6(hostname)])
  const addresses = [...(v4.status === 'fulfilled' ? v4.value : []), ...(v6.status === 'fulfilled' ? v6.value : [])]
  if (addresses.length === 0 && v4.status === 'rejected') throw v4.reason
  return addresses
}

/** Rejects fields that do not apply to the channel type, so API callers learn about typos instead of silent no-ops. */
function assertFieldsForType(type: AlertChannelType, input: Pick<AlertChannelCreateInput, 'secret' | 'config' | 'recipients' | 'generate_signing_secret'>): void {
  const label = ALERT_CHANNEL_LABELS[type]
  if (input.recipients !== undefined && type !== 'email') throw fieldError('recipients', `${label} channels have no recipients. Only email channels do.`)
  if (input.secret !== undefined) {
    if (type === 'email') throw fieldError('secret', 'Email channels have no secret. Send recipients instead.')
    const allowed = SECRET_KEYS_BY_TYPE[type]
    const extra = Object.keys(input.secret).filter((key) => !allowed.includes(key as keyof AlertChannelSecretInput))
    if (extra.length > 0) throw fieldError(`secret.${extra[0]}`, `secret.${extra[0]} does not apply to ${label} channels. Use ${allowed.map((key) => `secret.${key}`).join(' or ')}.`)
  }
  if (input.generate_signing_secret && type !== 'webhook') throw fieldError('generate_signing_secret', 'Only webhook channels sign their requests.')
  if (input.config?.region !== undefined && type !== 'opsgenie') throw fieldError('config.region', 'config.region applies to Opsgenie channels only.')
}

/**
 * Validates and normalises the write-only secret of a channel. `existing` is null when creating; when updating it is
 * the decrypted current secret (webhooks keep their URL or signing secret when only the other one changes).
 * Returns null when nothing about the secret changes.
 */
export async function prepareChannelSecret(
  type: AlertChannelType,
  input: AlertChannelSecretInput | undefined,
  options: { mode: 'create' | 'update'; generateSigningSecret?: boolean; existing?: ChannelSecret | null; resolve?: (hostname: string) => Promise<string[]> },
): Promise<PreparedSecret | null> {
  const creating = options.mode === 'create'
  if (type === 'email') return null

  if (isChatType(type)) {
    const raw = input?.webhook_url
    if (!raw) {
      if (creating) throw fieldError('secret.webhook_url', `Paste the ${ALERT_CHANNEL_LABELS[type]} webhook URL.`)
      return null
    }
    const checked = validateChatWebhookUrl(type, raw)
    if (!checked.ok) throw fieldError('secret.webhook_url', checked.reason)
    const url = checked.url ?? raw.trim()
    return { value: { webhook_url: url }, hint: secretHint(url), generated: null }
  }

  if (type === 'webhook') {
    const existing = options.existing ?? null
    const urlChanged = Boolean(input?.url)
    const signingChanged = Boolean(options.generateSigningSecret) || (input !== undefined && input.signing_secret !== undefined)
    if (!urlChanged && !signingChanged) {
      if (creating) throw fieldError('secret.url', 'Enter the URL that should receive the events.')
      return null
    }
    let url = existing?.url ?? null
    if (input?.url) {
      const checked = await validateMonitorUrlWithDns(input.url, options.resolve ?? resolvePublicAddresses)
      if (!checked.ok) throw fieldError('secret.url', checked.reason)
      url = checked.url ?? input.url.trim()
    }
    if (!url) throw fieldError('secret.url', 'Enter the URL that should receive the events.')
    let signingSecret: string | null = existing?.signing_secret ?? null
    let generated: string | null = null
    if (options.generateSigningSecret) {
      generated = `whsec_${randomBase62(32)}`
      signingSecret = generated
    } else if (input && input.signing_secret !== undefined) {
      signingSecret = input.signing_secret
    }
    return { value: { url, signing_secret: signingSecret }, hint: secretHint(url), generated }
  }

  if (type === 'pagerduty') {
    const key = input?.routing_key
    if (!key) {
      if (creating) throw fieldError('secret.routing_key', 'Paste the PagerDuty integration key (Events API v2).')
      return null
    }
    if (!ROUTING_KEY_PATTERN.test(key)) {
      throw fieldError('secret.routing_key', 'The integration key has 32 letters and numbers. Copy it again from the Events API v2 integration in PagerDuty.')
    }
    return { value: { routing_key: key }, hint: secretHint(key), generated: null }
  }

  // opsgenie
  const key = input?.api_key
  if (!key) {
    if (creating) throw fieldError('secret.api_key', 'Paste the Opsgenie API integration key.')
    return null
  }
  if (!OPSGENIE_KEY_PATTERN.test(key)) {
    throw fieldError('secret.api_key', 'The API key has 36 characters, like 1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f. Copy it again from the API integration in Opsgenie.')
  }
  return { value: { api_key: key }, hint: secretHint(key), generated: null }
}

/** Non-secret channel settings. Opsgenie keeps its region; webhooks remember whether they are signed (for the UI). */
export function channelConfig(type: AlertChannelType, input: AlertChannelCreateInput['config'], current: Record<string, unknown> | null, prepared: PreparedSecret | null): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(current ?? {}) }
  if (type === 'opsgenie') {
    base.region = input?.region ?? (base.region === 'eu' ? 'eu' : 'us')
  }
  if (type === 'webhook' && prepared) base.signed = Boolean(prepared.value.signing_secret)
  return base
}

async function writeChannelSecret(ctx: DomainContext, channelId: string, prepared: PreparedSecret): Promise<void> {
  const secretEncrypted = await encryptJson(prepared.value, env.secretsKey())
  unwrap(
    await ctx
      .admin()
      .from('alert_channel_secrets')
      .upsert({ channel_id: channelId, secret_encrypted: secretEncrypted, hint: prepared.hint, updated_at: new Date().toISOString() }, { onConflict: 'channel_id' }),
  )
}

async function readChannelSecret(ctx: DomainContext, channelId: string): Promise<ChannelSecret | null> {
  const row = unwrap(await ctx.admin().from('alert_channel_secrets').select('secret_encrypted').eq('channel_id', channelId).maybeSingle()) as { secret_encrypted: string } | null
  if (!row) return null
  try {
    return await decryptJson<ChannelSecret>(row.secret_encrypted, env.secretsKey())
  } catch {
    return null
  }
}

function toRecipientResource(row: RecipientRow): AlertRecipientResource {
  return { email: row.email, verified: row.verified_at !== null, verified_at: row.verified_at, verification_sent_at: row.verification_sent_at }
}

export function toChannelResource(
  row: ChannelRow,
  extras: { hint: string | null; recipients?: RecipientRow[]; lastDelivery?: { status: DeliveryStatus; error_message: string | null; updated_at: string } | null },
): AlertChannelResource {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: row.enabled,
    config: row.config ?? {},
    secret_hint: extras.hint,
    ...(row.type === 'email' ? { recipients: (extras.recipients ?? []).map(toRecipientResource) } : {}),
    last_delivery: extras.lastDelivery ? { status: extras.lastDelivery.status, error_message: extras.lastDelivery.error_message, at: extras.lastDelivery.updated_at } : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function loadChannelRow(ctx: DomainContext, projectId: string, channelId: string): Promise<ChannelRow> {
  if (!isUuid(channelId)) throw notFound('Alert channel')
  return unwrapOne(await ctx.db.from('alert_channels').select(CHANNEL_COLUMNS).eq('id', channelId).eq('project_id', projectId).maybeSingle(), 'Alert channel') as ChannelRow
}

async function loadChannels(ctx: DomainContext, projectId: string, ids?: string[]): Promise<AlertChannelResource[]> {
  let query = ctx.db.from('alert_channels').select(CHANNEL_COLUMNS).eq('project_id', projectId).order('created_at').order('id')
  if (ids) query = query.in('id', ids)
  const rows = unwrap(await query) as ChannelRow[]
  if (rows.length === 0) return []
  const channelIds = rows.map((row) => row.id)
  const emailIds = rows.filter((row) => row.type === 'email').map((row) => row.id)
  const [hints, recipients, deliveries] = await Promise.all([
    // Hints live next to the encrypted secret (service role only); read the hint column alone.
    ctx.admin().from('alert_channel_secrets').select('channel_id, hint').in('channel_id', channelIds),
    emailIds.length > 0 ? ctx.db.from('alert_email_recipients').select(RECIPIENT_COLUMNS).in('channel_id', emailIds).order('created_at').order('email') : Promise.resolve({ data: [], error: null }),
    Promise.all(
      channelIds.map((id) =>
        ctx.db.from('alert_deliveries').select('channel_id, status, error_message, updated_at').eq('channel_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ),
    ),
  ])
  const hintByChannel = new Map((unwrap(hints) as Array<{ channel_id: string; hint: string | null }>).map((row) => [row.channel_id, row.hint]))
  const recipientRows = unwrap(recipients as { data: RecipientRow[]; error: null }) as RecipientRow[]
  const lastByChannel = new Map<string, { status: DeliveryStatus; error_message: string | null; updated_at: string }>()
  for (const result of deliveries) {
    const row = unwrap(result) as { channel_id: string; status: DeliveryStatus; error_message: string | null; updated_at: string } | null
    if (row) lastByChannel.set(row.channel_id, row)
  }
  return rows.map((row) =>
    toChannelResource(row, {
      hint: hintByChannel.get(row.id) ?? null,
      recipients: recipientRows.filter((recipient) => recipient.channel_id === row.id),
      lastDelivery: lastByChannel.get(row.id) ?? null,
    }),
  )
}

export async function listAlertChannels(ctx: DomainContext, projectRef: string): Promise<AlertChannelResource[]> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return loadChannels(ctx, access.project.id)
}

export async function getAlertChannel(ctx: DomainContext, projectRef: string, channelId: string): Promise<AlertChannelResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const row = await loadChannelRow(ctx, access.project.id, channelId)
  const [resource] = await loadChannels(ctx, access.project.id, [row.id])
  if (!resource) throw notFound('Alert channel')
  return resource
}

// ------------------------------------------------------------------ recipients

function minutesAgo(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
}

/**
 * Sends (or re-sends) the double opt-in email. The token is generated here, only its SHA-256 is stored, and the
 * write happens with the service role because recipients have no update policy. The conditional update makes the
 * resend window atomic. Returns false when the email could not be sent (the recipient then shows "not sent").
 */
async function sendRecipientVerification(ctx: DomainContext, access: ProjectAccess, channel: ChannelRow, recipient: RecipientRow): Promise<boolean> {
  const token = generateToken('')
  const tokenHash = await sha256Hex(token)
  const cutoff = new Date(Date.now() - RECIPIENT_RESEND_MINUTES * 60_000).toISOString()
  const claimed = unwrap(
    await ctx
      .admin()
      .from('alert_email_recipients')
      .update({ token_hash: tokenHash, verification_sent_at: new Date().toISOString() })
      .eq('id', recipient.id)
      .eq('channel_id', channel.id)
      .is('verified_at', null)
      .or(`verification_sent_at.is.null,verification_sent_at.lt."${cutoff}"`)
      .select('id'),
  ) as Array<{ id: string }>
  if (claimed.length === 0) return false

  const rendered = renderRecipientVerificationEmail({
    projectName: access.project.name,
    verifyUrl: `${env.appUrl()}/alerts/verify?token=${encodeURIComponent(token)}`,
  })
  const sent = await sendEmail({ to: recipient.email, ...rendered, idempotencyKey: `alert-recipient:${recipient.id}:${tokenHash.slice(0, 16)}` })
  if (!sent.ok) {
    // Keep the link valid but show the address as "not sent" so the team can resend it.
    await ctx.admin().from('alert_email_recipients').update({ verification_sent_at: recipient.verification_sent_at }).eq('id', recipient.id)
    console.error('[alerts] verification email failed', sent.error)
    return false
  }
  return true
}

interface RecipientChanges {
  added: string[]
  removed: string[]
  /** New addresses that received a confirmation email. */
  invited: string[]
}

async function replaceRecipients(ctx: DomainContext, access: ProjectAccess, channel: ChannelRow, emails: string[]): Promise<RecipientChanges> {
  const desired = [...new Set(emails.map((value) => value.trim().toLowerCase()).filter(Boolean))]
  if (desired.length > MAX_RECIPIENTS) throw fieldError('recipients', `Add at most ${MAX_RECIPIENTS} recipients.`)
  const current = unwrap(await ctx.db.from('alert_email_recipients').select(RECIPIENT_COLUMNS).eq('channel_id', channel.id)) as RecipientRow[]
  const currentEmails = new Set(current.map((row) => row.email))
  const removed = current.filter((row) => !desired.includes(row.email)).map((row) => row.email)
  const added = desired.filter((value) => !currentEmails.has(value))
  if (removed.length > 0) unwrap(await ctx.db.from('alert_email_recipients').delete().eq('channel_id', channel.id).in('email', removed))
  const invited: string[] = []
  if (added.length > 0) {
    // The database confirms organization members on insert and leaves everyone else unverified (A-8).
    const inserted = unwrap(await ctx.db.from('alert_email_recipients').insert(added.map((value) => ({ channel_id: channel.id, email: value }))).select(RECIPIENT_COLUMNS)) as RecipientRow[]
    for (const recipient of inserted) {
      if (recipient.verified_at) continue
      if (await sendRecipientVerification(ctx, access, channel, recipient)) invited.push(recipient.email)
    }
  }
  return { added, removed, invited }
}

export async function resendRecipientVerification(ctx: DomainContext, projectRef: string, channelId: string, emailAddress: string): Promise<AlertChannelResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const channel = await loadChannelRow(ctx, access.project.id, channelId)
  if (channel.type !== 'email') throw invalid('Only email channels have recipients.')
  const address = emailAddress.trim().toLowerCase()
  const recipient = unwrap(await ctx.db.from('alert_email_recipients').select(RECIPIENT_COLUMNS).eq('channel_id', channel.id).eq('email', address).maybeSingle()) as RecipientRow | null
  if (!recipient) throw notFound('Recipient')
  if (recipient.verified_at) throw conflict(`${address} already confirmed.`)
  if (recipient.verification_sent_at) {
    const ago = minutesAgo(recipient.verification_sent_at)
    if (ago < RECIPIENT_RESEND_MINUTES) {
      const wait = RECIPIENT_RESEND_MINUTES - ago
      throw new DomainError('rate_limited', `A confirmation email went to ${address} ${ago === 0 ? 'less than a minute' : `${ago} min`} ago. You can send another one in ${wait} min.`)
    }
  }
  if (!(await sendRecipientVerification(ctx, access, channel, recipient))) {
    throw new DomainError('unavailable', `The confirmation email to ${address} could not be sent. Try again in a few minutes.`)
  }
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'alert_channel.verification_sent',
    targetType: 'alert_channel',
    targetId: channel.id,
    metadata: { email: address },
  })
  return getAlertChannel(ctx, access.project.id, channel.id)
}

// ------------------------------------------------------------------ create / update / delete

export async function createAlertChannel(ctx: DomainContext, projectRef: string, input: AlertChannelCreateInput): Promise<AlertChannelResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const type = input.type
  assertFieldsForType(type, input)
  if (type === 'email' && (input.recipients ?? []).length === 0) throw fieldError('recipients', 'Add at least one email address.')
  const prepared = await prepareChannelSecret(type, input.secret, { mode: 'create', generateSigningSecret: input.generate_signing_secret })
  const config = channelConfig(type, input.config, null, prepared)

  // The database refuses paging channels below Business with a readable message (alert_channels_guard).
  const row = unwrapOne(
    await ctx.db
      .from('alert_channels')
      .insert({ project_id: access.project.id, type, name: input.name, enabled: input.enabled ?? true, config, created_by: actorUserId(ctx) })
      .select(CHANNEL_COLUMNS)
      .single(),
    'Alert channel',
  ) as ChannelRow

  let recipients: RecipientChanges | null = null
  try {
    if (prepared) await writeChannelSecret(ctx, row.id, prepared)
    if (type === 'email') recipients = await replaceRecipients(ctx, access, row, input.recipients ?? [])
  } catch (error) {
    await ctx.db.from('alert_channels').delete().eq('id', row.id).eq('project_id', access.project.id)
    throw error
  }

  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'alert_channel.created',
    targetType: 'alert_channel',
    targetId: row.id,
    metadata: { type, name: row.name, ...(recipients ? { recipients: recipients.added.length, invited: recipients.invited.length } : {}), ...(type === 'webhook' ? { signed: Boolean(prepared?.value.signing_secret) } : {}) },
  })
  const resource = await getAlertChannel(ctx, access.project.id, row.id)
  return prepared?.generated ? { ...resource, signing_secret: prepared.generated } : resource
}

export async function updateAlertChannel(ctx: DomainContext, projectRef: string, channelId: string, input: AlertChannelUpdateInput): Promise<AlertChannelResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await loadChannelRow(ctx, access.project.id, channelId)
  if (input.type !== undefined && input.type !== current.type) {
    throw fieldError('type', 'A channel cannot change type. Create a new channel instead.')
  }
  assertFieldsForType(current.type, input)

  let prepared: PreparedSecret | null = null
  if (input.secret !== undefined || input.generate_signing_secret) {
    const existing = current.type === 'webhook' ? await readChannelSecret(ctx, current.id) : null
    prepared = await prepareChannelSecret(current.type, input.secret, { mode: 'update', generateSigningSecret: input.generate_signing_secret, existing })
  }

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== current.name) patch.name = input.name
  if (input.enabled !== undefined && input.enabled !== current.enabled) patch.enabled = input.enabled
  const config = channelConfig(current.type, input.config, current.config, prepared)
  if (JSON.stringify(config) !== JSON.stringify(current.config ?? {})) patch.config = config

  if (current.type === 'email' && input.recipients !== undefined && input.recipients.length === 0) {
    throw fieldError('recipients', 'Keep at least one email address, or delete the channel.')
  }

  // Secret first: if it fails, the channel keeps working with the previous one.
  if (prepared) await writeChannelSecret(ctx, current.id, prepared)
  if (Object.keys(patch).length > 0) unwrap(await ctx.db.from('alert_channels').update(patch).eq('id', current.id).eq('project_id', access.project.id))
  const recipients = current.type === 'email' && input.recipients !== undefined ? await replaceRecipients(ctx, access, current, input.recipients) : null

  const changes = [...Object.keys(patch), ...(prepared ? ['secret'] : []), ...(recipients && (recipients.added.length > 0 || recipients.removed.length > 0) ? ['recipients'] : [])]
  if (changes.length > 0) {
    await audit(ctx, {
      organizationId: access.organization.id,
      projectId: access.project.id,
      action: 'alert_channel.updated',
      targetType: 'alert_channel',
      targetId: current.id,
      metadata: { changes, ...(recipients ? { added: recipients.added, removed: recipients.removed } : {}) },
    })
  }
  const resource = await getAlertChannel(ctx, access.project.id, current.id)
  return prepared?.generated ? { ...resource, signing_secret: prepared.generated } : resource
}

/** Removes a deleted channel from the rules that pointed at it (best effort; the database trigger does the same). */
async function forgetChannelInRules(ctx: DomainContext, projectId: string, channelId: string): Promise<void> {
  try {
    const rules = unwrap(await ctx.db.from('alert_rules').select('id, channel_ids').eq('project_id', projectId).contains('channel_ids', [channelId])) as Array<{ id: string; channel_ids: string[] }>
    for (const rule of rules) {
      await ctx.db.from('alert_rules').update({ channel_ids: rule.channel_ids.filter((id) => id !== channelId) }).eq('id', rule.id).eq('project_id', projectId)
    }
  } catch (error) {
    console.error('[alerts] could not prune rules for deleted channel', error)
  }
}

export async function deleteAlertChannel(ctx: DomainContext, projectRef: string, channelId: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await loadChannelRow(ctx, access.project.id, channelId)
  await forgetChannelInRules(ctx, access.project.id, current.id)
  const deleted = unwrap(await ctx.db.from('alert_channels').delete().eq('id', current.id).eq('project_id', access.project.id).select('id')) as Array<{ id: string }>
  if (deleted.length === 0) throw notFound('Alert channel')
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'alert_channel.deleted',
    targetType: 'alert_channel',
    targetId: current.id,
    metadata: { type: current.type, name: current.name },
  })
}

// ------------------------------------------------------------------ test

async function consumeTestQuota(ctx: DomainContext, projectId: string): Promise<void> {
  const { data, error } = await ctx.admin().rpc('consume_rate_limit', {
    p_bucket: `alert-test:${projectId}`,
    p_limit: TEST_ALERTS_PER_WINDOW,
    p_window_seconds: TEST_WINDOW_MINUTES * 60,
  })
  if (error || !data) return // fail open: the limit protects providers, it must not block a real check
  const state = data as { allowed: boolean; reset_at: string }
  if (!state.allowed) {
    const wait = Math.max(1, Math.ceil((new Date(state.reset_at).getTime() - Date.now()) / 60_000))
    throw new DomainError('rate_limited', `You can send ${TEST_ALERTS_PER_WINDOW} test alerts every ${TEST_WINDOW_MINUTES} minutes. Try again in ${wait} min.`)
  }
}

/** Sends a test alert through one channel (ignores rules, the master switch and maintenance). */
export async function testAlertChannel(ctx: DomainContext, projectRef: string, channelId: string): Promise<AlertTestResult> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const channel = await loadChannelRow(ctx, access.project.id, channelId)
  if (!channel.enabled) throw conflict('This channel is off. Turn it on to send a test alert.')
  if (channel.type === 'email') {
    const { count, error } = await ctx.db.from('alert_email_recipients').select('id', { count: 'exact', head: true }).eq('channel_id', channel.id).not('verified_at', 'is', null)
    if (error) throw fromDatabaseError(error)
    if (!count) throw conflict('Nobody on this channel has confirmed yet. Ask them to open the confirmation email, then send the test again.')
  }
  await consumeTestQuota(ctx, access.project.id)

  const reason = ctx.actor.type === 'api_key' ? `Sent through the API by ${ctx.actor.label}.` : `Sent from the dashboard by ${ctx.actor.label}.`
  const { data, error } = await ctx.admin().rpc('enqueue_alert_event_and_dispatch', {
    p_project_id: access.project.id,
    p_type: 'test',
    p_source_type: 'test',
    p_source_id: null,
    p_severity: 'test',
    p_dedupe_key: `test:${channel.id}:${Date.now()}`,
    p_payload: { channel_id: channel.id, project_name: access.project.name, reason },
  })
  if (error) throw fromDatabaseError(error, 'Alert channel')
  const result = (Array.isArray(data) ? data[0] : data) as { event_id: string; delivery_count: number } | undefined
  if (!result) throw new DomainError('internal', 'The test alert could not be queued. Try again in a moment.')

  let suppressionReason: string | null = null
  if (result.delivery_count === 0) {
    const event = unwrap(await ctx.admin().from('alert_events').select('suppression_reason').eq('id', result.event_id).maybeSingle()) as { suppression_reason: string | null } | null
    suppressionReason = event?.suppression_reason ?? 'no_verified_targets'
  }
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'alert_channel.tested',
    targetType: 'alert_channel',
    targetId: channel.id,
    metadata: { deliveries: result.delivery_count, event_id: result.event_id },
  })
  return { event_id: result.event_id, deliveries: result.delivery_count, suppression_reason: suppressionReason }
}

// ======================================================================
// Rules
// ======================================================================

const RULE_COLUMNS = 'id, project_id, name, enabled, event_types, component_ids, monitor_ids, min_status, channel_ids, cooldown_minutes, position, created_by, created_at, updated_at'

export function toRuleResource(row: AlertRuleRow): AlertRuleResource {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    event_types: row.event_types,
    component_ids: row.component_ids ?? [],
    monitor_ids: row.monitor_ids ?? [],
    min_status: row.min_status,
    channel_ids: row.channel_ids ?? [],
    cooldown_minutes: row.cooldown_minutes,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

const REF_TABLES = {
  channel_ids: { table: 'alert_channels', what: 'Channel' },
  component_ids: { table: 'components', what: 'Component' },
  monitor_ids: { table: 'monitors', what: 'Monitor' },
} as const
type RefField = keyof typeof REF_TABLES

async function existingIds(ctx: DomainContext, field: RefField, projectId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = unwrap(await ctx.db.from(REF_TABLES[field].table).select('id').eq('project_id', projectId).in('id', ids)) as Array<{ id: string }>
  return new Set(rows.map((row) => row.id))
}

/** Every id must belong to this status page. */
async function checkRefs(ctx: DomainContext, field: RefField, projectId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)]
  const known = await existingIds(ctx, field, projectId, unique)
  const missing = unique.find((id) => !known.has(id))
  if (missing) throw fieldError(field, `${REF_TABLES[field].what} ${missing} was not found in this status page.`)
  return unique
}

/** Drops ids of items deleted since the rule was saved, so unrelated edits do not fail the database check. */
async function pruneRefs(ctx: DomainContext, field: RefField, projectId: string, ids: string[]): Promise<string[]> {
  const known = await existingIds(ctx, field, projectId, ids)
  return ids.filter((id) => known.has(id))
}

function uniqueEvents(types: string[]): string[] {
  return [...new Set(types)]
}

async function loadRuleRow(ctx: DomainContext, projectId: string, ruleId: string): Promise<AlertRuleRow> {
  if (!isUuid(ruleId)) throw notFound('Alert rule')
  return unwrapOne(await ctx.db.from('alert_rules').select(RULE_COLUMNS).eq('id', ruleId).eq('project_id', projectId).maybeSingle(), 'Alert rule') as AlertRuleRow
}

export async function listAlertRules(ctx: DomainContext, projectRef: string): Promise<AlertRuleResource[]> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const rows = unwrap(await ctx.db.from('alert_rules').select(RULE_COLUMNS).eq('project_id', access.project.id).order('position').order('created_at')) as AlertRuleRow[]
  return rows.map(toRuleResource)
}

export async function getAlertRule(ctx: DomainContext, projectRef: string, ruleId: string): Promise<AlertRuleResource> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  return toRuleResource(await loadRuleRow(ctx, access.project.id, ruleId))
}

export async function createAlertRule(ctx: DomainContext, projectRef: string, input: AlertRuleCreateInput): Promise<AlertRuleResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const projectId = access.project.id
  const [channelIds, componentIds, monitorIds] = await Promise.all([
    checkRefs(ctx, 'channel_ids', projectId, input.channel_ids ?? []),
    checkRefs(ctx, 'component_ids', projectId, input.component_ids ?? []),
    checkRefs(ctx, 'monitor_ids', projectId, input.monitor_ids ?? []),
  ])
  let position = input.position
  if (position === undefined) {
    const last = unwrap(await ctx.db.from('alert_rules').select('position').eq('project_id', projectId).order('position', { ascending: false }).limit(1)) as Array<{ position: number }>
    position = last.length > 0 ? last[0]!.position + 1 : 0
  }
  const row = unwrapOne(
    await ctx.db
      .from('alert_rules')
      .insert({
        project_id: projectId,
        name: input.name,
        enabled: input.enabled ?? true,
        event_types: uniqueEvents(input.event_types),
        component_ids: componentIds,
        monitor_ids: monitorIds,
        min_status: input.min_status ?? null,
        channel_ids: channelIds,
        cooldown_minutes: input.cooldown_minutes ?? 15,
        position,
        created_by: actorUserId(ctx),
      })
      .select(RULE_COLUMNS)
      .single(),
    'Alert rule',
  ) as AlertRuleRow
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId,
    action: 'alert_rule.created',
    targetType: 'alert_rule',
    targetId: row.id,
    metadata: { name: row.name, event_types: row.event_types, channels: row.channel_ids.length },
  })
  return toRuleResource(row)
}

export async function updateAlertRule(ctx: DomainContext, projectRef: string, ruleId: string, input: AlertRuleUpdateInput): Promise<AlertRuleResource> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const projectId = access.project.id
  const current = await loadRuleRow(ctx, projectId, ruleId)
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== current.name) patch.name = input.name
  if (input.enabled !== undefined && input.enabled !== current.enabled) patch.enabled = input.enabled
  if (input.event_types !== undefined) patch.event_types = uniqueEvents(input.event_types)
  if (input.min_status !== undefined && input.min_status !== current.min_status) patch.min_status = input.min_status
  if (input.cooldown_minutes !== undefined && input.cooldown_minutes !== current.cooldown_minutes) patch.cooldown_minutes = input.cooldown_minutes
  if (input.position !== undefined && input.position !== current.position) patch.position = input.position

  for (const field of Object.keys(REF_TABLES) as RefField[]) {
    const provided = input[field]
    if (provided !== undefined) {
      patch[field] = await checkRefs(ctx, field, projectId, provided)
    } else if ((current[field] ?? []).length > 0) {
      const kept = await pruneRefs(ctx, field, projectId, current[field] ?? [])
      if (kept.length !== (current[field] ?? []).length) patch[field] = kept
    }
  }
  if (Object.keys(patch).length === 0) return toRuleResource(current)

  const row = unwrapOne(await ctx.db.from('alert_rules').update(patch).eq('id', current.id).eq('project_id', projectId).select(RULE_COLUMNS).maybeSingle(), 'Alert rule') as AlertRuleRow
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId,
    action: 'alert_rule.updated',
    targetType: 'alert_rule',
    targetId: row.id,
    metadata: { changes: Object.keys(patch) },
  })
  return toRuleResource(row)
}

export async function deleteAlertRule(ctx: DomainContext, projectRef: string, ruleId: string): Promise<void> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const current = await loadRuleRow(ctx, access.project.id, ruleId)
  unwrap(await ctx.db.from('alert_rules').delete().eq('id', current.id).eq('project_id', access.project.id))
  await audit(ctx, {
    organizationId: access.organization.id,
    projectId: access.project.id,
    action: 'alert_rule.deleted',
    targetType: 'alert_rule',
    targetId: current.id,
    metadata: { name: current.name },
  })
}

export async function reorderAlertRules(ctx: DomainContext, projectRef: string, input: AlertRuleReorderInput): Promise<AlertRuleResource[]> {
  const access = await requireProject(ctx, projectRef, 'admin')
  const projectId = access.project.id
  const rows = unwrap(await ctx.db.from('alert_rules').select(RULE_COLUMNS).eq('project_id', projectId)) as AlertRuleRow[]
  const known = new Set(rows.map((row) => row.id))
  const ordered = [...new Set(input.rule_ids)]
  if (ordered.length !== rows.length || ordered.some((id) => !known.has(id))) {
    throw fieldError('rule_ids', 'Send every rule of this status page exactly once, in the new order.')
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const [position, id] of ordered.entries()) {
    if (byId.get(id)!.position === position) continue
    unwrap(await ctx.db.from('alert_rules').update({ position }).eq('id', id).eq('project_id', projectId))
  }
  await audit(ctx, { organizationId: access.organization.id, projectId, action: 'alert_rule.reordered', targetType: 'project', targetId: projectId })
  return listAlertRules(ctx, projectId)
}

// ======================================================================
// Event log
// ======================================================================

const EVENT_COLUMNS = 'id, project_id, type, source_type, source_id, status, severity, dedupe_key, payload, audience, suppression_reason, created_at, processed_at'
const DELIVERY_COLUMNS = 'id, event_id, channel_id, rule_id, target, target_type, status, attempts, error_code, error_message, next_retry_at, sent_at, created_at'

export function toDeliveryResource(row: Pick<AlertDeliveryRow, 'id' | 'channel_id' | 'rule_id' | 'target' | 'target_type' | 'status' | 'attempts' | 'error_code' | 'error_message' | 'next_retry_at' | 'sent_at' | 'created_at'>): AlertDeliveryResource {
  return {
    id: row.id,
    channel_id: row.channel_id,
    rule_id: row.rule_id,
    target: row.target,
    target_type: row.target_type,
    status: row.status,
    attempts: row.attempts,
    error_code: row.error_code,
    error_message: row.error_message,
    next_retry_at: row.next_retry_at,
    sent_at: row.sent_at,
    created_at: row.created_at,
  }
}

export interface AlertEventFilters {
  type?: string
  status?: AlertEventStatusFilter
}

/** Recent team alert events, newest first, with their deliveries. */
export async function listAlertEvents(ctx: DomainContext, projectRef: string, page: PageRequest, filters: AlertEventFilters = {}): Promise<Page<AlertEventResource>> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const failedOnly = filters.status === 'failed'
  let query = ctx.db
    .from('alert_events')
    .select(failedOnly ? `${EVENT_COLUMNS}, alert_deliveries!inner(status)` : EVENT_COLUMNS)
    .eq('project_id', access.project.id)
    .eq('audience', 'team')
  if (filters.type) query = query.eq('type', filters.type)
  if (failedOnly) query = query.eq('alert_deliveries.status', 'failed')
  else if (filters.status) query = query.eq('status', filters.status)
  if (page.cursor) query = query.or(keysetFilter('created_at', page.cursor))
  const rows = unwrap(await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(page.limit + 1)) as unknown as AlertEventRow[]
  const result = toPage(rows, page, (row) => row.created_at)

  const ids = result.items.map((row) => row.id)
  const deliveries = ids.length > 0 ? (unwrap(await ctx.db.from('alert_deliveries').select(DELIVERY_COLUMNS).in('event_id', ids).order('created_at')) as AlertDeliveryRow[]) : []
  const project = {
    id: access.project.id,
    name: access.project.name,
    slug: access.project.slug,
    organization_slug: access.organization.slug,
    brand_color: access.project.brand_color,
    logo_url: access.project.logo_url,
    custom_domain: access.project.custom_domain_status === 'verified' ? access.project.custom_domain : null,
  }
  const links = { appUrl: env.appUrl() }
  return {
    nextCursor: result.nextCursor,
    items: result.items.map((row) => ({
      id: row.id,
      type: row.type,
      title: buildAlertMessage(
        { id: row.id, project_id: row.project_id, type: row.type, source_type: row.source_type, source_id: row.source_id, severity: row.severity, dedupe_key: row.dedupe_key, payload: (row.payload ?? {}) as AlertPayload, audience: row.audience, created_at: row.created_at },
        project,
        links,
      ).title,
      status: row.status,
      suppression_reason: row.suppression_reason,
      source_type: row.source_type,
      created_at: row.created_at,
      processed_at: row.processed_at,
      deliveries: deliveries.filter((delivery) => delivery.event_id === row.id).map(toDeliveryResource),
    })),
  }
}

// ------------------------------------------------------------------ recipient confirmation (public link)

/**
 * Confirms an alert email recipient from the link in the confirmation email. The token is the only authority
 * (it is single-use: the hash is cleared on success). Returns null when the link is unknown or already used.
 */
export async function verifyAlertRecipientToken(token: string): Promise<{ email: string; project_name: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(token)) return null
  const { data, error } = await createAdminClient().rpc('verify_alert_recipient', { p_token: token })
  if (error) {
    console.error('[alerts] verify_alert_recipient failed', error.message)
    throw new DomainError('unavailable', 'The confirmation could not be saved. Try the link again in a moment.')
  }
  return (data as { email: string; project_name: string | null } | null) ?? null
}
