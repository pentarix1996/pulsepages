import 'server-only'
import { hasRole, type OrgRole } from '@shared/domain.ts'
import { planAllows, planLimit, type Plan } from '@shared/plans.ts'
import { env } from '@/lib/env'
import { requireProject, type OrganizationSummary, type ProjectAccess } from './access'
import { publicStatusPageUrl } from './access-tokens'
import { audit } from './audit'
import type { DomainContext } from './context'
import { defaultDomainDeps } from './custom-domains'
import { DomainError, invalid } from './errors'
import {
  LOGO_CONTENT_TYPES,
  LOGO_MAX_BYTES,
  readUptimeWeights,
  type LogoContentType,
  type LogoUploadResult,
  type ProjectSettingsResource,
} from './schemas/status-page'
import type { ProjectRow } from './types'

/** Project as the API returns it (api.md "Project"), built from a projects row. */
export function toProjectSettingsResource(project: ProjectRow, organization: Pick<OrganizationSummary, 'slug'>): ProjectSettingsResource {
  return {
    id: project.id,
    organization_id: project.organization_id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    visibility: project.visibility,
    status_page_url: publicStatusPageUrl({ project, organization }),
    custom_domain: project.custom_domain,
    custom_domain_status: project.custom_domain ? project.custom_domain_status : 'none',
    custom_domain_verified_at: project.custom_domain_verified_at,
    custom_domain_error: project.custom_domain_error,
    brand_color: project.brand_color,
    logo_url: project.logo_url,
    theme_default: project.theme_default,
    timezone: project.timezone,
    support_url: project.support_url,
    hide_powered_by: project.hide_powered_by,
    auto_postmortem: project.auto_postmortem,
    auto_draft_incidents: project.auto_draft_incidents,
    allowed_ips: project.allowed_ips ?? [],
    uptime_weights: readUptimeWeights(project.uptime_weights),
    created_at: project.created_at,
    updated_at: project.updated_at,
  }
}

export interface StatusPageSettings {
  access: ProjectAccess
  project: ProjectSettingsResource
  plan: Plan
  role: OrgRole
  canEdit: boolean
  /** Base for the default URL: {appUrl}/status/{org}/ */
  pathPrefix: string
  cnameTarget: string
  gates: { branding: boolean; customDomain: boolean; privatePages: boolean }
  subscriberLimit: number
}

/** Everything the settings page shows; edits go through PATCH /api/app/projects/{id} and the routes in this area. */
export async function getStatusPageSettings(ctx: DomainContext, projectRef: string): Promise<StatusPageSettings> {
  const access = await requireProject(ctx, projectRef, 'viewer')
  const plan = access.organization.plan
  return {
    access,
    project: toProjectSettingsResource(access.project, access.organization),
    plan,
    role: access.role,
    canEdit: hasRole(access.role, 'admin'),
    pathPrefix: `${env.appUrl()}/status/${access.organization.slug}/`,
    cnameTarget: defaultDomainDeps().target,
    gates: {
      branding: planAllows(plan, 'custom_domain'),
      customDomain: planAllows(plan, 'custom_domain'),
      privatePages: planAllows(plan, 'private_pages'),
    },
    subscriberLimit: planLimit(plan, 'subscribers_per_project'),
  }
}

// ------------------------------------------------------------------ logo upload

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

/** Detects the image type from its first bytes (never trust the browser's MIME type alone). */
export function sniffImageType(bytes: Uint8Array): LogoContentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 2048)).replace(/^﻿/, '').trimStart().toLowerCase()
  if ((head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!--') || head.startsWith('<!doctype svg')) && head.includes('<svg')) return 'image/svg+xml'
  return null
}

const SVG_FORBIDDEN: Array<[RegExp, string]> = [
  [/<script[\s>/]/i, 'scripts'],
  [/\son[a-z]+\s*=/i, 'event handlers'],
  [/javascript\s*:/i, 'javascript: links'],
  [/<foreignobject[\s>/]/i, 'embedded HTML'],
  [/<(iframe|embed|object|audio|video)[\s>/]/i, 'embedded content'],
  [/<!entity/i, 'XML entities'],
  [/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpe?g|gif|webp);)[^"']/i, 'external references'],
  [/url\(\s*["']?\s*(?!#)[a-z]+:/i, 'external references'],
  [/@import/i, 'external stylesheets'],
]

/** SVG logos are served from Storage and shown in emails and pages: only plain, self-contained drawings. */
export function svgProblem(text: string): string | null {
  for (const [pattern, what] of SVG_FORBIDDEN) {
    if (pattern.test(text)) return what
  }
  return null
}

export function validateLogo(file: { size: number; type: string; bytes: Uint8Array }): { contentType: LogoContentType; extension: string } {
  if (file.size === 0) throw invalid('The file is empty.', [{ path: 'file', message: 'The file is empty.' }])
  if (file.size > LOGO_MAX_BYTES) throw invalid('Logos can be up to 1 MB. Export a smaller image.', [{ path: 'file', message: 'Logos can be up to 1 MB.' }])
  const detected = sniffImageType(file.bytes)
  if (!detected) throw invalid('Upload a PNG, JPEG, WebP or SVG image.', [{ path: 'file', message: 'Upload a PNG, JPEG, WebP or SVG image.' }])
  if (detected === 'image/svg+xml') {
    const problem = svgProblem(new TextDecoder().decode(file.bytes))
    if (problem) {
      const message = `This SVG contains ${problem}. Export it again as a plain SVG, or upload a PNG.`
      throw invalid(message, [{ path: 'file', message }])
    }
  }
  return { contentType: detected, extension: LOGO_CONTENT_TYPES[detected] }
}

const BUCKET = 'branding'

/**
 * Stores a logo at branding/<projectId>/logo-<timestamp>.<ext> and returns its public URL for the settings form, which
 * saves it as logo_url. Older uploads that are not the current logo are removed.
 */
export async function uploadProjectLogo(ctx: DomainContext, projectRef: string, file: { size: number; type: string; bytes: Uint8Array }): Promise<LogoUploadResult> {
  const access = await requireProject(ctx, projectRef, 'admin')
  if (!planAllows(access.organization.plan, 'custom_domain')) {
    throw new DomainError('plan_required', 'Branding requires the Pro plan. Upgrade to add your logo.')
  }
  const { contentType, extension } = validateLogo(file)
  const projectId = access.project.id
  const fileName = `logo-${Date.now()}.${extension}`
  const path = `${projectId}/${fileName}`
  const storage = ctx.admin().storage.from(BUCKET)
  const { error } = await storage.upload(path, file.bytes, { contentType, cacheControl: '31536000', upsert: false })
  if (error) {
    console.error('[logo] upload failed', error.message)
    throw new DomainError('unavailable', 'The logo could not be stored. Try again in a moment.')
  }
  const url = storage.getPublicUrl(path).data.publicUrl

  // Housekeeping: keep the new file and the one the page uses today.
  try {
    const current = access.project.logo_url ?? ''
    const { data: existing } = await storage.list(projectId, { limit: 100 })
    const stale = (existing ?? []).filter((object) => object.name.startsWith('logo-') && object.name !== fileName && !current.endsWith(`/${projectId}/${object.name}`))
    if (stale.length > 0) await storage.remove(stale.map((object) => `${projectId}/${object.name}`))
  } catch (cleanupError) {
    console.error('[logo] cleanup failed', cleanupError)
  }

  await audit(ctx, {
    organizationId: access.organization.id,
    projectId,
    action: 'status_page.logo_uploaded',
    targetType: 'project',
    targetId: projectId,
    metadata: { path, content_type: contentType, size: file.size },
  })
  return { url, path, content_type: contentType, size: file.size }
}
