'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { LatencyChart, type LatencySeries } from '@/components/ui/Charts'
import { Segmented } from '@/components/ui/Segmented'
import type { LatencyBucket } from '@/lib/domain/monitors'
import { formatMs } from '@/lib/format'
import { regionCode, regionName } from './shared'

interface Props {
  range: '24h' | '7d'
  from: string
  to: string
  buckets: LatencyBucket[]
  regions: string[]
  threshold: number | null
}

interface Point {
  at: number
  p50: number | null
  p95: number | null
  checks: number
  failing: number
}

/** Collapses region buckets into one series: slowest p95 and check-weighted p50 per bucket. */
function combine(buckets: LatencyBucket[], region: string): Point[] {
  const byStart = new Map<string, LatencyBucket[]>()
  for (const bucket of buckets) {
    if (region !== 'all' && bucket.region !== region) continue
    const list = byStart.get(bucket.bucket_start) ?? []
    list.push(bucket)
    byStart.set(bucket.bucket_start, list)
  }
  return [...byStart.entries()]
    .map(([start, list]) => {
      const measured = list.filter((bucket) => bucket.p50_latency_ms !== null && bucket.checks > 0)
      const weight = measured.reduce((sum, bucket) => sum + bucket.checks, 0)
      const p95s = measured.map((bucket) => bucket.p95_latency_ms).filter((value): value is number => value !== null)
      return {
        at: Date.parse(start),
        p50: weight > 0 ? Math.round(measured.reduce((sum, bucket) => sum + (bucket.p50_latency_ms ?? 0) * bucket.checks, 0) / weight) : null,
        p95: p95s.length > 0 ? Math.max(...p95s) : null,
        checks: list.reduce((sum, bucket) => sum + bucket.checks, 0),
        failing: list.reduce((sum, bucket) => sum + bucket.failing, 0),
      }
    })
    .sort((a, b) => a.at - b.at)
}

export function ResponseTimeCard({ range, from, to, buckets, regions, threshold }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [region, setRegion] = useState<string>('all')
  const points = useMemo(() => combine(buckets, region), [buckets, region])

  const setRange = (next: '24h' | '7d') => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === '24h') params.delete('range')
    else params.set('range', next)
    router.replace(params.size > 0 ? `${pathname}?${params}` : pathname, { scroll: false })
  }

  const series: LatencySeries[] = [
    { name: 'p95', color: '#A9A6FF', points: points.map((point) => ({ at: point.at, value: point.p95 })) },
    { name: 'p50', color: '#7FD8B1', points: points.map((point) => ({ at: point.at, value: point.p50 })) },
  ]
  const measured = points.filter((point) => point.p95 !== null)
  const checks = points.reduce((sum, point) => sum + point.checks, 0)
  const failing = points.reduce((sum, point) => sum + point.failing, 0)
  const medianP95 = measured.length > 0 ? [...measured].map((point) => point.p95 as number).sort((a, b) => a - b)[Math.floor(measured.length / 2)] : null
  const slowBuckets = threshold ? measured.filter((point) => (point.p95 ?? 0) > threshold).length : 0
  const scope = region === 'all' ? 'across regions' : `from ${regionName(region)}`
  const period = range === '7d' ? 'the last 7 days' : 'the last 24 hours'
  const note =
    checks === 0
      ? `No checks ${scope} in ${period} yet.`
      : `Typical p95 ${scope} was ${formatMs(medianP95)} over ${period}. ${failing === 0 ? `All ${checks.toLocaleString('en-US')} checks passed.` : `${failing.toLocaleString('en-US')} of ${checks.toLocaleString('en-US')} checks failed.`}${slowBuckets > 0 ? ` ${slowBuckets} ${slowBuckets === 1 ? 'interval was' : 'intervals were'} above the degraded threshold.` : ''}`

  return (
    <Card aria-label="Response time">
      <div className="card-h">
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <h2>Response time</h2>
          <div className="mon-legend" aria-hidden="true">
            <span>
              <i style={{ background: '#A9A6FF' }} />
              p95{region === 'all' ? ', slowest region' : ''}
            </span>
            <span>
              <i style={{ background: '#7FD8B1' }} />
              p50
            </span>
            {threshold ? (
              <span>
                <i className="dash" />
                Degraded above {formatMs(threshold)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="row row-wrap" style={{ ['--gap' as string]: '8px' }}>
          {regions.length > 1 ? (
            <Segmented<string>
              label="Region"
              value={region}
              onChange={setRegion}
              options={[{ value: 'all', label: 'All' }, ...regions.map((id) => ({ value: id, label: regionCode(id) }))]}
            />
          ) : null}
          <Segmented<'24h' | '7d'>
            label="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: '24h', label: '24 hours' },
              { value: '7d', label: '7 days' },
            ]}
          />
        </div>
      </div>
      {measured.length < 2 ? (
        <p className="mon-chart-empty">Response times appear here after a few checks.</p>
      ) : (
        <div className="mon-chart">
          <LatencyChart series={series} from={Date.parse(from)} to={Date.parse(to)} threshold={threshold} label={`Response time ${scope}, ${period}. ${note}`} />
        </div>
      )}
      <p className="mon-chart-note">{note}</p>
    </Card>
  )
}
