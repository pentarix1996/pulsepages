import 'server-only'
import type { DomainContext } from './context'

export interface AuditEntry {
  organizationId: string
  projectId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Records who did what (spec §1). Every mutation in lib/domain calls this, so the dashboard and the API leave the
 * same trail. Failures are logged, not thrown: the change already happened and must not be reported as failed.
 */
export async function audit(ctx: DomainContext, entry: AuditEntry): Promise<void> {
  const actorId = ctx.actor.type === 'system' ? null : ctx.actor.id
  try {
    const { error } = await ctx.admin().rpc('write_audit_log', {
      p_organization_id: entry.organizationId,
      p_project_id: entry.projectId ?? null,
      p_actor_type: ctx.actor.type,
      p_actor_id: actorId,
      p_actor_label: ctx.actor.label,
      p_action: entry.action,
      p_target_type: entry.targetType ?? null,
      p_target_id: entry.targetId ?? null,
      p_metadata: { ...(entry.metadata ?? {}), request_id: ctx.requestId },
      p_ip: ctx.ip,
    })
    if (error) console.error('[audit] write failed', entry.action, error.message)
  } catch (error) {
    console.error('[audit] write failed', entry.action, error)
  }
}
