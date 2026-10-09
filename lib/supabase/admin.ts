import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function serviceCredentials() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on the server.')
  }
  return { supabaseUrl, serviceRoleKey }
}

/**
 * Fully privileged client (bypasses RLS and the plan/managed-field guards).
 * Use only for system work, after an explicit authorization check in lib/domain.
 */
export function createAdminClient(): SupabaseClient {
  const { supabaseUrl, serviceRoleKey } = serviceCredentials()
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Service-role client that acts for an API key. The database recognises the `x-upvane-actor` header
 * (public.request_api_actor) and applies the same guards as for dashboard users: plan limits raise instead of
 * clamping, managed fields stay read-only and custom domains cannot be self-verified.
 */
export function createActorClient(actor: string): SupabaseClient {
  const { supabaseUrl, serviceRoleKey } = serviceCredentials()
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-upvane-actor': actor } },
  })
}
