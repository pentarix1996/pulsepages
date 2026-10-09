// Small SVG charts without dependencies: sparkline and latency per region with a threshold line.

export function Sparkline({ values, color = 'var(--accent)', height = 28, label }: { values: number[]; color?: string; height?: number; label?: string }) {
  if (values.length < 2) return <svg className="sparkline" height={height} aria-hidden="true" />
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const width = 160
  const points = values.map((value, index) => `${((index / (values.length - 1)) * width).toFixed(1)} ${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(1)}`)
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={`M${points.join(' L')}`} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export interface LatencySeries {
  name: string
  color: string
  points: Array<{ at: number; value: number | null }>
}

const PALETTE = ['#A9A6FF', '#34D39A', '#5E9BFF', '#F4B740', '#F28A3E', '#FF7A83', '#7FD8B1', '#C9D3E6']
export function seriesColor(index: number): string {
  return PALETTE[index % PALETTE.length]!
}

/** Multi-series latency chart. `from`/`to` in epoch ms. */
export function LatencyChart({ series, from, to, threshold, height = 220, label }: { series: LatencySeries[]; from: number; to: number; threshold?: number | null; height?: number; label: string }) {
  const width = 800
  const padLeft = 44
  const padBottom = 22
  const values = series.flatMap((item) => item.points.map((point) => point.value).filter((value): value is number => value !== null))
  const maxValue = Math.max(threshold ?? 0, ...values, 100)
  const top = Math.ceil((maxValue * 1.15) / 50) * 50
  const x = (at: number) => padLeft + ((at - from) / Math.max(1, to - from)) * (width - padLeft - 8)
  const y = (value: number) => (height - padBottom) - (value / top) * (height - padBottom - 8)
  const ticks = [0, top / 2, top]
  const hours = (to - from) / 3_600_000
  const timeTicks = [from, from + (to - from) / 2, to]
  const timeLabel = (at: number) => new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, ...(hours > 48 ? { month: 'short', day: 'numeric' } : {}) })

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label} preserveAspectRatio="none">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={padLeft} x2={width - 8} y1={y(tick)} y2={y(tick)} stroke="rgba(148,170,210,.13)" strokeWidth="1" />
          <text x={padLeft - 8} y={y(tick) + 4} textAnchor="end">
            {Math.round(tick)}
          </text>
        </g>
      ))}
      {timeTicks.map((at, index) => (
        <text key={at} x={x(at)} y={height - 6} textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}>
          {timeLabel(at)}
        </text>
      ))}
      {threshold ? <line x1={padLeft} x2={width - 8} y1={y(threshold)} y2={y(threshold)} stroke="#F4B740" strokeDasharray="5 5" strokeWidth="1.2" /> : null}
      {series.map((item) => {
        const segments: string[] = []
        let current = ''
        for (const point of item.points) {
          if (point.value === null) {
            if (current) segments.push(current)
            current = ''
            continue
          }
          current += `${current ? ' L' : 'M'}${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`
        }
        if (current) segments.push(current)
        return segments.map((d, index) => <path key={`${item.name}-${index}`} d={d} fill="none" stroke={item.color} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)
      })}
    </svg>
  )
}
