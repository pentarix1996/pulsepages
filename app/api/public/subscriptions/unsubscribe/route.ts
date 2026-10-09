// RFC 8058 one-click unsubscribe. Mail providers POST "List-Unsubscribe=One-Click" to the List-Unsubscribe URL
// (/subscriptions/unsubscribe?token=…); proxy.ts routes that POST here. People who click the link get the page.
import { sha256Hex } from '@shared/crypto.ts'
import { adminRpc } from '@/lib/status-page/data'

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return new Response('Unknown or used unsubscribe link.', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  await adminRpc('unsubscribe_from_status_page', { p_token_hash: await sha256Hex(token) })
  // Same answer whether or not the subscription still existed, so the endpoint does not reveal subscriptions.
  return new Response('Unsubscribed.', { status: 200, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}
