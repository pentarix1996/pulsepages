import { appHandler } from '@/lib/http/app'
import { exportSubscribersCsv } from '@/lib/domain/subscribers'

/** Downloads every subscriber as CSV (admins). */
export const GET = appHandler<{ projectId: string }>(async ({ ctx, params }) => {
  const { filename, csv } = await exportSubscribersCsv(ctx, params.projectId)
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
