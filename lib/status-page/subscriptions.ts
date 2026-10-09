import 'server-only'
// Confirmation and unsubscribe links from subscriber emails. The token in the link is the only authority; the
// database stores its SHA-256 hash, so a leaked table cannot be turned into working links.
import { statusPageUrl } from '@shared/alerts/message.ts'
import { sha256Hex } from '@shared/crypto.ts'
import { env } from '@/lib/env'
import { adminRpc, getAccessInfo } from './data'

const TOKEN = /^[A-Za-z0-9_-]{20,160}$/

export interface SubscriptionPage {
  id: string
  name: string
  url: string
  brand_color: string | null
  logo_url: string | null
}

export interface SubscriptionInfo {
  project_id: string
  type: 'email' | 'slack' | 'webhook'
  email: string | null
  target_hint: string | null
  confirmed: boolean
}

export async function subscriptionPage(projectId: string): Promise<SubscriptionPage | null> {
  const info = await getAccessInfo(projectId)
  if (!info) return null
  return {
    id: info.id,
    name: info.name,
    url: statusPageUrl({ organization_slug: info.organization_slug, slug: info.slug, custom_domain: info.custom_domain }, { appUrl: env.appUrl() }),
    brand_color: info.brand_color,
    logo_url: info.logo_url,
  }
}

/** Confirms an email subscription. Null when the link is unknown or already used. */
export async function confirmSubscription(token: string): Promise<{ project_id: string; email: string | null } | null> {
  if (!TOKEN.test(token)) return null
  return adminRpc<{ project_id: string; email: string | null }>('confirm_status_page_subscription', { p_token_hash: await sha256Hex(token) })
}

/** What an unsubscribe link points at, without changing anything. */
export async function readSubscription(token: string): Promise<SubscriptionInfo | null> {
  if (!TOKEN.test(token)) return null
  return adminRpc<SubscriptionInfo>('get_status_page_subscription', { p_unsubscribe_token_hash: await sha256Hex(token) })
}

export async function unsubscribe(token: string): Promise<{ project_id: string; email: string | null } | null> {
  if (!TOKEN.test(token)) return null
  return adminRpc<{ project_id: string; email: string | null }>('unsubscribe_from_status_page', { p_token_hash: await sha256Hex(token) })
}
