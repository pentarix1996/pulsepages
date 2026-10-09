import { jsonResponse } from '../../../_feeds'

export async function GET(_request: Request, { params }: { params: Promise<{ org: string; slug: string }> }) {
  return jsonResponse(params, 'summary')
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' } })
}
