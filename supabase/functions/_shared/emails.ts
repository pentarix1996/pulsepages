// Transactional email templates (team alerts, subscriber updates, confirmations, invitations).
// Plain table layout with inline styles so it renders in every client; every template also returns a text part.
import type { AlertMessage } from './alerts/types.ts'
import { ORG_ROLE_LABELS } from './domain.ts'
import type { OrgRole } from './domain.ts'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const INK = '#121826'
const MUTED = '#4F5A70'
const FAINT = '#677287'
const LINE = '#E3E6EC'
const SURFACE = '#FFFFFF'
const PAGE = '#F5F6F8'
const BRAND = '#5B58E8'

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function emailButton(url: string, label: string, color = BRAND): string {
  const href = safeUrl(url)
  if (!href) return ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td style="border-radius:8px;background:${safeColor(color, BRAND)}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#FFFFFF;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td></tr></table>`
}

export function emailLayout(options: {
  preheader: string
  heading: string
  bodyHtml: string
  footerHtml?: string
  accent?: string | null
  brandName?: string
  logoUrl?: string | null
}): string {
  const accent = safeColor(options.accent, BRAND)
  const logo = safeUrl(options.logoUrl)
  const brand = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(options.brandName ?? 'Upvane')}" height="28" style="height:28px;max-width:180px;display:block">`
    : `<span style="display:inline-block;width:24px;height:24px;border-radius:6px;background:${accent};vertical-align:middle"></span><span style="font:650 16px/24px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};vertical-align:middle;margin-left:8px">${escapeHtml(options.brandName ?? 'Upvane')}</span>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(options.heading)}</title></head>
<body style="margin:0;padding:0;background:${PAGE}">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${escapeHtml(options.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 16px">${brand}</td></tr>
<tr><td style="background:${SURFACE};border:1px solid ${LINE};border-radius:12px;border-top:4px solid ${accent};padding:28px 28px 24px">
<h1 style="margin:0 0 12px;font:650 21px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">${escapeHtml(options.heading)}</h1>
<div style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${options.bodyHtml}</div>
</td></tr>
<tr><td style="padding:16px 4px;font:400 12.5px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${FAINT}">${options.footerHtml ?? 'Sent by Upvane.'}</td></tr>
</table></td></tr></table></body></html>`
}

function fieldsTable(fields: Array<{ label: string; value: string }>): string {
  if (fields.length === 0) return ''
  const rows = fields
    .map((field) => `<tr><td style="padding:8px 12px 8px 0;color:${FAINT};font-size:13px;white-space:nowrap;vertical-align:top;border-top:1px solid ${LINE}">${escapeHtml(field.label)}</td><td style="padding:8px 0;color:${INK};font-size:14px;border-top:1px solid ${LINE}">${escapeHtml(field.value)}</td></tr>`)
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;border-collapse:collapse">${rows}</table>`
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 12px">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Alert for the team (email channel). */
export function renderTeamAlertEmail(message: AlertMessage, options: { manageUrl?: string | null } = {}): RenderedEmail {
  const subject = `[${message.projectName}] ${message.title}`
  const links = [
    message.dashboardUrl ? emailButton(message.dashboardUrl, message.dashboardLabel, message.color) : '',
    message.statusPageUrl ? `<p style="margin:8px 0 0;font-size:13.5px"><a href="${escapeHtml(message.statusPageUrl)}" style="color:${BRAND}">View the public status page</a></p>` : '',
  ].join('')
  const html = emailLayout({
    preheader: message.summary || message.title,
    heading: message.title,
    accent: message.color,
    bodyHtml: `${message.summary ? paragraphs(message.summary) : ''}${fieldsTable(message.fields)}${links}`,
    footerHtml: `${escapeHtml(message.projectName)} · ${escapeHtml(new Date(message.occurredAt).toUTCString())}${options.manageUrl ? ` · <a href="${escapeHtml(options.manageUrl)}" style="color:${FAINT}">Alert settings</a>` : ''}`,
  })
  const text = [
    message.title,
    '',
    message.summary,
    '',
    ...message.fields.map((field) => `${field.label}: ${field.value}`),
    '',
    message.dashboardUrl ? `${message.dashboardLabel}: ${message.dashboardUrl}` : '',
    message.statusPageUrl ? `Status page: ${message.statusPageUrl}` : '',
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n')
    .trim()
  return { subject, html, text }
}

/** Update for a status page subscriber. Uses the page's branding. */
export function renderSubscriberUpdateEmail(message: AlertMessage, options: { pageName: string; pageUrl: string; unsubscribeUrl: string; brandColor?: string | null; logoUrl?: string | null }): RenderedEmail {
  const subject = `[${options.pageName}] ${message.title}`
  const accent = safeColor(options.brandColor, '#0E7490')
  const html = emailLayout({
    preheader: message.summary || message.title,
    heading: message.title,
    accent,
    brandName: options.pageName,
    logoUrl: options.logoUrl,
    bodyHtml: `${message.summary ? paragraphs(message.summary) : ''}${fieldsTable(message.fields)}${emailButton(message.statusPageUrl ?? options.pageUrl, 'View status page', accent)}`,
    footerHtml: `You subscribed to updates from ${escapeHtml(options.pageName)}. <a href="${escapeHtml(options.unsubscribeUrl)}" style="color:${FAINT}">Unsubscribe</a>.`,
  })
  const text = `${message.title}\n\n${message.summary}\n\n${message.fields.map((field) => `${field.label}: ${field.value}`).join('\n')}\n\nStatus page: ${message.statusPageUrl ?? options.pageUrl}\nUnsubscribe: ${options.unsubscribeUrl}`.trim()
  return { subject, html, text }
}

export function renderSubscriptionConfirmationEmail(options: { pageName: string; confirmUrl: string; brandColor?: string | null; logoUrl?: string | null }): RenderedEmail {
  const accent = safeColor(options.brandColor, '#0E7490')
  const subject = `Confirm your subscription to ${options.pageName}`
  const html = emailLayout({
    preheader: `Confirm to get incident and maintenance updates from ${options.pageName}.`,
    heading: 'Confirm your subscription',
    accent,
    brandName: options.pageName,
    logoUrl: options.logoUrl,
    bodyHtml: `<p style="margin:0">Confirm your email to get incident and maintenance updates from ${escapeHtml(options.pageName)}.</p>${emailButton(options.confirmUrl, 'Confirm subscription', accent)}<p style="margin:12px 0 0;font-size:13px;color:${FAINT}">If you did not ask for this, ignore this email and nothing will happen.</p>`,
  })
  const text = `Confirm your email to get incident and maintenance updates from ${options.pageName}:\n${options.confirmUrl}\n\nIf you did not ask for this, ignore this email.`
  return { subject, html, text }
}

export function renderRecipientVerificationEmail(options: { projectName: string; verifyUrl: string }): RenderedEmail {
  const subject = `Confirm you want alerts for ${options.projectName}`
  const html = emailLayout({
    preheader: `Someone added this address to the ${options.projectName} alerts on Upvane.`,
    heading: 'Confirm alert emails',
    bodyHtml: `<p style="margin:0">Someone added this address to the alert channel of <strong style="color:${INK}">${escapeHtml(options.projectName)}</strong> on Upvane. Confirm to start receiving outage and incident alerts.</p>${emailButton(options.verifyUrl, 'Confirm alert emails')}<p style="margin:12px 0 0;font-size:13px;color:${FAINT}">If you were not expecting this, ignore the email. You will not get any alerts.</p>`,
  })
  const text = `Someone added this address to the alert channel of ${options.projectName} on Upvane. Confirm to start receiving alerts:\n${options.verifyUrl}\n\nIf you were not expecting this, ignore the email.`
  return { subject, html, text }
}

export function renderInvitationEmail(options: { organizationName: string; inviterName: string; role: OrgRole; acceptUrl: string; expiresAt: string }): RenderedEmail {
  const role = ORG_ROLE_LABELS[options.role] ?? options.role
  const subject = `${options.inviterName} invited you to ${options.organizationName} on Upvane`
  const html = emailLayout({
    preheader: `Join ${options.organizationName} as ${role}.`,
    heading: `Join ${options.organizationName}`,
    bodyHtml: `<p style="margin:0">${escapeHtml(options.inviterName)} invited you to join <strong style="color:${INK}">${escapeHtml(options.organizationName)}</strong> on Upvane as <strong style="color:${INK}">${escapeHtml(role)}</strong>.</p>${emailButton(options.acceptUrl, 'Accept invitation')}<p style="margin:12px 0 0;font-size:13px;color:${FAINT}">The invitation expires on ${escapeHtml(new Date(options.expiresAt).toUTCString())}. Sign in or create an account with this email address to accept it.</p>`,
  })
  const text = `${options.inviterName} invited you to join ${options.organizationName} on Upvane as ${role}.\n\nAccept: ${options.acceptUrl}\n\nThe invitation expires on ${new Date(options.expiresAt).toUTCString()}.`
  return { subject, html, text }
}
