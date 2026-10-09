import { COMPONENT_STATUS_LABELS, isComponentStatus, type ComponentStatus } from '@shared/domain.ts'
import { formatDate, formatDuration } from '@/lib/format'

export interface UptimeDay {
  date: string
  status: ComponentStatus | null
  downtime_minutes?: number
  major_minutes?: number
  partial_minutes?: number
  degraded_minutes?: number
  maintenance_minutes?: number
  incidents?: Array<{ id: string; title: string; impact?: string }>
}

function summary(days: UptimeDay[]): string {
  const withData = days.filter((day) => day.status !== null)
  const bad = withData.filter((day) => day.status !== 'operational')
  if (withData.length === 0) return 'No data yet'
  return bad.length === 0 ? `${withData.length} days without issues` : `${bad.length} of ${withData.length} days with issues`
}

/** One bar per day with a hover tooltip (minutes per status, incidents). The group exposes a text summary. */
export function UptimeBars({ days, label, size = 'md', showLegend = false, uptime }: { days: UptimeDay[]; label: string; size?: 'md' | 'lg'; showLegend?: boolean; uptime?: string }) {
  // Tooltips near either end anchor to that end so they stay on screen (a tip is ~220 px wide).
  const edge = Math.ceil(days.length * 0.3)
  return (
    <div className="stack" style={{ ['--gap' as string]: '6px' }}>
      <div className={['bars', size === 'lg' ? 'bars-lg' : ''].join(' ')} role="img" aria-label={`${label}: ${summary(days)}${uptime ? `, ${uptime} uptime` : ''}`}>
        {days.map((day, index) => {
          const status: ComponentStatus | 'none' = isComponentStatus(day.status) ? day.status : 'none'
          const position = index < edge ? 'tip-l' : index >= days.length - edge ? 'tip-r' : ''
          const lines: string[] = []
          if (day.major_minutes) lines.push(`Major outage ${formatDuration(day.major_minutes * 60)}`)
          if (day.partial_minutes) lines.push(`Partial outage ${formatDuration(day.partial_minutes * 60)}`)
          if (day.degraded_minutes) lines.push(`Degraded ${formatDuration(day.degraded_minutes * 60)}`)
          if (day.maintenance_minutes) lines.push(`Maintenance ${formatDuration(day.maintenance_minutes * 60)}`)
          return (
            <span key={day.date} className={`bar b-${status}`}>
              <span className={['bar-tip', position].join(' ')} aria-hidden="true">
                <strong>{formatDate(day.date)}</strong>
                <span>{status === 'none' ? 'No data' : status === 'operational' && lines.length === 0 ? 'No downtime' : COMPONENT_STATUS_LABELS[status]}</span>
                {lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
                {(day.incidents ?? []).slice(0, 3).map((incident) => (
                  <span key={incident.id}>· {incident.title}</span>
                ))}
              </span>
            </span>
          )
        })}
      </div>
      {showLegend ? (
        <div className="bars-legend" aria-hidden="true">
          <span>{days.length} days ago</span>
          {uptime ? <span>{uptime} uptime</span> : null}
          <span>Today</span>
        </div>
      ) : null}
    </div>
  )
}
