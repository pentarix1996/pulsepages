import { appHandler } from '@/lib/http/app'
import { readQuery } from '@/lib/http/responses'
import { CSV_EXPORT_KINDS, exportReportCsv, type CsvExportKind } from '@/lib/domain/metrics'
import { metricsQuery } from '@/lib/domain/schemas/metrics'

type P = { projectId: string }

/** GET ?from&to&kind=uptime|incidents → text/csv download (viewers can export). */
export const GET = appHandler<P>(async ({ ctx, params, request }) => {
  const url = new URL(request.url)
  const query = readQuery(url, metricsQuery.pick({ from: true, to: true }))
  const requested = url.searchParams.get('kind') ?? 'uptime'
  const kind: CsvExportKind = (CSV_EXPORT_KINDS as readonly string[]).includes(requested) ? (requested as CsvExportKind) : 'uptime'
  const { filename, csv } = await exportReportCsv(ctx, params.projectId, query, kind)
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
