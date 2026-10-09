import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { authErrorMessage, type AuthErrorLike } from '@/components/auth/errors'
import { env } from '@/lib/env'
import { requireDashboardUser } from './access'
import type { DomainContext } from './context'
import { DomainError, conflict, invalid, unauthorized, unwrap } from './errors'
import type { AccountResource, AccountUpdateInput, EmailChangeInput, PasswordChangeInput } from './schemas/account'

/** Supabase Auth errors as domain errors with readable messages. */
export function authDomainError(error: AuthErrorLike, field?: string): DomainError {
  const message = authErrorMessage(error)
  if (error.status === 429 || /rate_limit/.test(error.code ?? '')) return new DomainError('rate_limited', message)
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return conflict(message)
  if (error.status === 401 || error.code === 'session_not_found') return unauthorized(message)
  if (error.status && error.status >= 500) return new DomainError('unavailable', 'Sign-in is temporarily unavailable. Try again in a moment.')
  return invalid(message, field ? [{ path: field, message }] : undefined)
}

export async function getAccount(ctx: DomainContext): Promise<AccountResource> {
  requireDashboardUser(ctx)
  const [{ data, error }, profile] = await Promise.all([
    ctx.db.auth.getUser(),
    ctx.db.from('profiles').select('name, username').eq('id', ctx.actor.id).maybeSingle(),
  ])
  if (error || !data.user) throw unauthorized()
  const user = data.user
  const row = profile.data as { name: string | null; username: string | null } | null
  const metadataName = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : null
  return {
    id: user.id,
    email: user.email ?? null,
    new_email: user.new_email ?? null,
    name: row?.name ?? metadataName,
    username: row?.username ?? null,
    created_at: user.created_at,
  }
}

/** The name shows in the sidebar, the members list, invitations and incident timelines. */
export async function updateAccountName(ctx: DomainContext, input: AccountUpdateInput): Promise<AccountResource> {
  requireDashboardUser(ctx)
  unwrap(await ctx.db.from('profiles').update({ name: input.name }).eq('id', ctx.actor.id))
  const { error } = await ctx.db.auth.updateUser({ data: { name: input.name } })
  if (error) throw authDomainError(error, 'name')
  return getAccount(ctx)
}

/**
 * Starts an email change (B-6): nothing happens when the address did not change; otherwise Supabase emails a
 * confirmation link (to both addresses when "secure email change" is on) and the change applies once confirmed.
 */
export async function changeEmail(ctx: DomainContext, input: EmailChangeInput, redirectTo: string): Promise<{ changed: boolean; pending_email: string | null; email: string | null }> {
  requireDashboardUser(ctx)
  const requested = input.email.trim().toLowerCase()
  const current = (ctx.actor.email ?? '').trim().toLowerCase()
  if (requested === current) return { changed: false, pending_email: null, email: ctx.actor.email }
  const { data, error } = await ctx.db.auth.updateUser({ email: requested }, { emailRedirectTo: redirectTo })
  if (error) throw authDomainError(error, 'email')
  const user = data.user
  const applied = user?.email?.toLowerCase() === requested
  return { changed: true, pending_email: applied ? null : user?.new_email ?? requested, email: user?.email ?? ctx.actor.email }
}

/** Checks the current password without touching the signed-in session (a throwaway client signs in and out). */
async function verifyCurrentPassword(email: string, password: string): Promise<void> {
  const verifier = createClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await verifier.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) {
      throw invalid('Your current password is not correct.', [{ path: 'current_password', message: 'Your current password is not correct.' }])
    }
    throw authDomainError(error, 'current_password')
  }
  await verifier.auth.signOut({ scope: 'local' }).catch(() => undefined)
}

export async function changePassword(ctx: DomainContext, input: PasswordChangeInput): Promise<void> {
  requireDashboardUser(ctx)
  if (!ctx.actor.email) throw invalid('Your account has no email address, so the password cannot be changed here.')
  if (input.current_password === input.password) {
    throw invalid('Choose a password that is different from your current one.', [{ path: 'password', message: 'Choose a password that is different from your current one.' }])
  }
  await verifyCurrentPassword(ctx.actor.email, input.current_password)
  const { error } = await ctx.db.auth.updateUser({ password: input.password })
  if (error) throw authDomainError(error, 'password')
}
