import { feedResponse } from '../_feeds'

export async function GET(_request: Request, { params }: { params: Promise<{ org: string; slug: string }> }) {
  return feedResponse(params, 'atom')
}
