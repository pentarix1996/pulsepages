import type { AlertEmailChannelConfig, StoredAlertEvent } from '../types'

export interface AlertEmailPayload {
  to: string
  subject: string
  html: string
  text: string
}

interface AlertEmailViewModel {
  title: string
  eyebrow: string
  summary: string
  projectName: string
  statusLabel: string
  componentName: string | null
  incidentTitle: string | null
  monitorSummary: string | null
  occurredAt: string
  dashboardUrl: string | null
  statusPageUrl: string | null
}

export function renderAlertEmail(event: StoredAlertEvent, _config: AlertEmailChannelConfig, target: string): AlertEmailPayload {
  const model = createAlertEmailViewModel(event)
  return {
    to: target,
    subject: model.title,
    html: renderHtml(model),
    text: renderText(model),
  }
}

export function createAlertEmailViewModel(event: StoredAlertEvent): AlertEmailViewModel {
  const payload = event.payload
  const status = payload.status ? humanize(String(payload.status)) : 'Update'
  const component = payload.component?.name ?? null
  const incident = payload.incident?.title ?? null
  const title = `[Upvane] ${payload.project_name}: ${humanize(event.type)}`
  const monitor = payload.monitor
  const monitorSummary = monitor
    ? [
        monitor.status ? `check ${monitor.status}` : null,
        monitor.http_status ? `HTTP ${monitor.http_status}` : null,
        monitor.response_time_ms !== null ? `${monitor.response_time_ms}ms` : null,
        monitor.error_message,
      ].filter(Boolean).join(' · ')
    : null

  return {
    title,
    eyebrow: humanize(event.type),
    summary: payload.reason || `${payload.project_name} changed to ${status}.`,
    projectName: payload.project_name,
    statusLabel: status,
    componentName: component,
    incidentTitle: incident,
    monitorSummary,
    occurredAt: formatTimestamp(payload.occurred_at),
    dashboardUrl: payload.dashboard_url,
    statusPageUrl: payload.status_page_url,
  }
}

function renderHtml(model: AlertEmailViewModel): string {
  const dashboardLink = model.dashboardUrl ? `<a href="${escapeAttribute(model.dashboardUrl)}" style="color:#a78bfa;text-decoration:none;">Open dashboard</a>` : ''
  const statusLink = model.statusPageUrl ? `<a href="${escapeAttribute(model.statusPageUrl)}" style="color:#a78bfa;text-decoration:none;">View status page</a>` : ''
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#08090c;color:#f8fafc;font-family:Inter,Arial,sans-serif;">
    <table width="100%" role="presentation" cellspacing="0" cellpadding="0" style="background:#08090c;padding:32px 16px;">
      <tr><td align="center">
        <table width="100%" role="presentation" cellspacing="0" cellpadding="0" style="max-width:640px;background:#11131a;border:1px solid #272a36;border-radius:20px;overflow:hidden;">
          <tr><td style="padding:28px 32px;border-bottom:1px solid #272a36;">
            <p style="margin:0 0 8px;color:#a78bfa;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Upvane Alert</p>
            <h1 style="margin:0;color:#f8fafc;font-size:24px;line-height:1.25;">${escapeHtml(model.eyebrow)}</h1>
            <p style="margin:12px 0 0;color:#cbd5e1;font-size:15px;line-height:1.6;">${escapeHtml(model.summary)}</p>
          </td></tr>
          <tr><td style="padding:24px 32px;">
            ${row('Project', model.projectName)}
            ${row('Status', model.statusLabel)}
            ${model.componentName ? row('Component', model.componentName) : ''}
            ${model.incidentTitle ? row('Incident', model.incidentTitle) : ''}
            ${model.monitorSummary ? row('Monitor', model.monitorSummary) : ''}
            ${row('Time', model.occurredAt)}
            <p style="margin:24px 0 0;color:#94a3b8;font-size:14px;">${[dashboardLink, statusLink].filter(Boolean).join(' &nbsp;·&nbsp; ')}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function renderText(model: AlertEmailViewModel): string {
  return [
    'Upvane Alert',
    model.eyebrow,
    '',
    model.summary,
    '',
    `Project: ${model.projectName}`,
    `Status: ${model.statusLabel}`,
    model.componentName ? `Component: ${model.componentName}` : null,
    model.incidentTitle ? `Incident: ${model.incidentTitle}` : null,
    model.monitorSummary ? `Monitor: ${model.monitorSummary}` : null,
    `Time: ${model.occurredAt}`,
    model.dashboardUrl ? `Dashboard: ${model.dashboardUrl}` : null,
    model.statusPageUrl ? `Status page: ${model.statusPageUrl}` : null,
  ].filter(Boolean).join('\n')
}

function row(label: string, value: string): string {
  return `<p style="margin:0 0 12px;color:#94a3b8;font-size:14px;"><strong style="display:inline-block;min-width:96px;color:#f8fafc;">${escapeHtml(label)}</strong>${escapeHtml(value)}</p>`
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}
