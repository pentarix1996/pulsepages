'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardHeader, EmptyState } from '@/components/ui/Card'
import { StatusDot } from '@/components/ui/Status'
import type { OverviewData } from '@/lib/domain/overview'
import { formatMs } from '@/lib/format'
import { clockTime, dayTile, leadTime, regionCode, timeRange } from './format'

const POLL_MS = 20_000

/** Latest probe results. Refreshes while the tab is visible; rows that arrived since the last render slide in. */
export function LiveChecks({ data, canAdmin }: { data: OverviewData; canAdmin: boolean }) {
  const router = useRouter()
  // Rows present on first render stay still; anything that arrives with a refresh slides in once.
  const [initial] = useState(() => new Set(data.checks.map((check) => check.id)))

  useEffect(() => {
    if (data.kpis.monitors.total === 0) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [router, data.kpis.monitors.total])

  const base = `/p/${data.project.id}`
  return (
    <Card aria-label="Live checks">
      <CardHeader
        title="Live checks"
        actions={
          data.kpis.monitors.total > 0 ? (
            <span className="ov-live">
              <StatusDot status="operational" pulse />
              Updating
            </span>
          ) : null
        }
      />
      {data.checks.length === 0 ? (
        <EmptyState
          title="No checks yet"
          description="Monitors check your services from several regions and show each result here."
          action={canAdmin ? <ButtonLink href={`${base}/monitors/new`} size="sm">Add monitor</ButtonLink> : null}
        />
      ) : (
        <div className="ov-feed" role="list" aria-label="Latest check results">
          {data.checks.slice(0, 9).map((check) => {
            const region = regionCode(check.region)
            const tone = check.status === 'up' || check.status === 'success' ? 'code-ok' : check.status === 'degraded' ? 'code-slow' : check.status === 'error' ? 'code-err' : 'code-bad'
            const code = check.http_status ? String(check.http_status) : check.monitor_type === 'heartbeat' ? (tone === 'code-ok' ? 'ping' : 'late') : tone === 'code-ok' ? 'ok' : tone === 'code-slow' ? 'slow' : tone === 'code-err' ? 'err' : 'fail'
            return (
              <div key={check.id} role="listitem" className={['ov-frow', initial.has(check.id) ? '' : 'arrive'].join(' ')} title={check.error_message ?? undefined}>
                <span className="mono num faint">{clockTime(check.checked_at, data.project.timezone, true)}</span>
                <span className="ov-frow-what">
                  <span className="mono faint" title={region.city}>
                    {region.code}
                  </span>
                  {check.monitor_id ? (
                    <Link className="truncate ov-frow-name" href={`${base}/monitors/${check.monitor_id}`}>
                      {check.monitor_name}
                    </Link>
                  ) : (
                    <span className="truncate">{check.monitor_name}</span>
                  )}
                </span>
                <span className={`code-chip ${tone}`}>{code}</span>
                <span className="mono num muted ov-frow-ms">{formatMs(check.response_time_ms)}</span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export function UpcomingMaintenance({ data, canRespond }: { data: OverviewData; canRespond: boolean }) {
  const base = `/p/${data.project.id}`
  const next = data.maintenance.upcoming.slice(0, 2)
  return (
    <Card aria-label="Upcoming maintenance">
      <CardHeader
        title="Upcoming maintenance"
        actions={
          <Link className="link" href={`${base}/maintenance`} style={{ fontSize: 13 }}>
            {next.length > 0 ? 'All windows' : canRespond ? 'Schedule' : 'Maintenance'}
          </Link>
        }
      />
      {next.length === 0 ? (
        <p className="ov-side-empty">Nothing scheduled. Announce windows ahead so subscribers know what to expect.</p>
      ) : (
        <div className="ov-maint-list">
          {next.map((maintenance) => {
            const tile = dayTile(maintenance.scheduled_start, data.project.timezone)
            return (
              <Link key={maintenance.id} href={`${base}/maintenance/${maintenance.id}`} className="ov-maint">
                <span className="ov-day" aria-hidden="true">
                  <span>{tile.weekday}</span>
                  <strong>{tile.day}</strong>
                </span>
                <span className="stack" style={{ ['--gap' as string]: '4px', minWidth: 0 }}>
                  <strong className="ov-maint-title">{maintenance.title}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {tile.month} {tile.day}, {timeRange(maintenance.scheduled_start, maintenance.scheduled_end, data.project.timezone)}
                  </span>
                  <span className="faint" style={{ fontSize: 12.5 }}>
                    {[
                      maintenance.components.length > 0 ? `${maintenance.components.join(', ')}` : 'No components listed',
                      maintenance.mute_alerts ? 'alerts muted' : null,
                      maintenance.notify_subscribers && maintenance.reminder_minutes > 0 ? `reminder ${leadTime(maintenance.reminder_minutes)} before` : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export function StatusPageCard({ data, canAdmin }: { data: OverviewData; canAdmin: boolean }) {
  const base = `/p/${data.project.id}`
  const subscribers = data.status_page.subscribers
  const host = data.project.status_page_url.replace(/^https?:\/\//, '')
  return (
    <Card aria-label="Status page">
      <CardHeader
        title="Status page"
        actions={
          <a className="link" href={data.project.status_page_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
            Open
          </a>
        }
      />
      <div className="ov-sp">
        <span className="mono ov-sp-url">{host}</span>
        <span className="faint" style={{ fontSize: 12.5 }}>
          {data.project.visibility === 'private' ? 'Private: only people with access can see it.' : 'Public.'}
          {data.project.custom_domain && data.project.custom_domain_status !== 'verified' ? ` ${data.project.custom_domain} is waiting for DNS.` : ''}
        </span>
        {subscribers ? (
          <div className="ov-sp-counts">
            <span>
              <strong className="num">{subscribers.email.toLocaleString('en-US')}</strong>
              <span>Email</span>
            </span>
            <span>
              <strong className="num">{subscribers.slack.toLocaleString('en-US')}</strong>
              <span>Slack</span>
            </span>
            <span>
              <strong className="num">{subscribers.webhook.toLocaleString('en-US')}</strong>
              <span>Webhook</span>
            </span>
          </div>
        ) : null}
        {canAdmin ? (
          <Link className="link" href={`${base}/status-page`} style={{ fontSize: 13 }}>
            Branding, domain and visibility
          </Link>
        ) : null}
      </div>
    </Card>
  )
}
