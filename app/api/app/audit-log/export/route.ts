import { appHandler } from '@/lib/http/app'
import { readQuery } from '@/lib/http/responses'
import { exportAuditLogCsv } from '@/lib/domain/audit-log'
import { auditLogFilters } from '@/lib/domain/schemas/organizations'
import { uuid } from '@/lib/domain/schemas/common'

const exportQuery = auditLogFilters.extend({ organization: uuid })

/** GET /api/app/audit-log/export?organization=<id>&action=&actor=&from=&to= → CSV download (Business). */
export const GET = appHandler(async ({ ctx, request }) => {
  const { organization, ...filters } = readQuery(new URL(request.url), exportQuery)
  const file = await exportAuditLogCsv(ctx, organization, filters)
  return new Response(file.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
      'X-Upvane-Rows': String(file.rows),
      'X-Upvane-Truncated': String(file.truncated),
    },
  })
})
