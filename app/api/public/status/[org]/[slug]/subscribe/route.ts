// POST /api/public/status/{org}/{slug}/subscribe — visitors subscribe from the status page (JSON from the popover, or a
// plain form post without JavaScript). Rate limited per address; a hidden honeypot field silently drops bots.
import { consumeRateLimit } from '@/lib/http/api'
import { errorJson } from '@/lib/http/responses'
import { invalid } from '@/lib/domain/errors'
import { currentRequest, resolveStatusView } from '@/lib/status-page/access'
import { clientIp } from '@/lib/status-page/cidr'
import { pageHref } from '@/lib/status-page/links'
import { HONEYPOT_FIELD, normalizeSubscribeFields, subscribeInput, subscribeToPage } from '@/lib/status-page/subscribe'

type Params = { params: Promise<{ org: string; slug: string }> }

const NO_STORE = { 'Cache-Control': 'no-store' }

async function readFields(request: Request): Promise<{ fields: Record<string, unknown>; form: boolean }> {
  const type = request.headers.get('content-type') ?? ''
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const data = await request.formData()
    const fields: Record<string, unknown> = {}
    for (const [key, value] of data.entries()) {
      if (typeof value !== 'string') continue
      if (key === 'component_ids') fields.component_ids = [...((fields.component_ids as string[] | undefined) ?? []), value]
      else fields[key] = value
    }
    return { fields, form: true }
  }
  const text = await request.text()
  if (text.length > 20_000) throw invalid('The request is too large.')
  try {
    const parsed = text.trim() ? JSON.parse(text) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return { fields: parsed as Record<string, unknown>, form: false }
  } catch {
    throw invalid('Send the subscription as JSON.')
  }
}

export async function POST(request: Request, { params }: Params) {
  const { org, slug } = await params
  let form = false
  try {
    const context = await currentRequest()
    const view = await resolveStatusView(org, slug, context)
    if (view.kind !== 'page') return Response.json({ error: 'Status page not found.', code: 'not_found' }, { status: 404, headers: NO_STORE })

    const ip = clientIp(context.headers) ?? 'unknown'
    const limit = await consumeRateLimit(`subscribe:${view.page.project.id}:${ip}`, 8, 600)
    if (!limit.state.allowed) {
      return Response.json({ error: 'Too many attempts from your network. Try again in a few minutes.', code: 'rate_limited' }, { status: 429, headers: { ...NO_STORE, ...limit.headers } })
    }

    const read = await readFields(request)
    form = read.form
    const pretend = { result: 'confirmation_sent' as const, message: 'Check your inbox to confirm.' }
    const outcome = typeof read.fields[HONEYPOT_FIELD] === 'string' && (read.fields[HONEYPOT_FIELD] as string).trim() !== '' ? pretend : await subscribeToPage(view.page, subscribeInput.parse(normalizeSubscribeFields(read.fields)))

    if (form) {
      const target = new URL(pageHref(view.location, `?subscribe=${outcome.result}#subscribe`), request.url)
      return Response.redirect(target, 303)
    }
    return Response.json({ data: outcome }, { status: 201, headers: NO_STORE })
  } catch (error) {
    if (form) {
      const target = new URL(`/status/${encodeURIComponent(org)}/${encodeURIComponent(slug)}?subscribe=error#subscribe`, request.url)
      return Response.redirect(target, 303)
    }
    return errorJson(error, NO_STORE)
  }
}
