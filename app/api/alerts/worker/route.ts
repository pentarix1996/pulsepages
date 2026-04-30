import { NextResponse } from 'next/server'
import { processPendingAlerts } from '@/lib/alerts/processor'

export async function POST(request: Request) {
  const expectedSecret = process.env.ALERT_WORKER_SECRET ?? ''
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!expectedSecret || token !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await processPendingAlerts()
  return NextResponse.json(result)
}
