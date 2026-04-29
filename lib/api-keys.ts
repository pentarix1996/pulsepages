// lib/api-keys.ts
// Client-side API key management functions
// Token flow: generate random token → store SHA-256 hash → return plain token to UI (show ONCE)

import { createClient } from '@/lib/supabase/client'
import type { ApiKey } from '@/lib/types'

const supabase = createClient()

/**
 * Generates a random API token with the prefix `pp_live_`
 * Format: pp_live_ + 32 random hex characters (no dashes)
 */
function generateToken(): string {
  const uuid = crypto.randomUUID().replaceAll('-', '')
  const randomPart = uuid.substring(0, 32)
  return `pp_live_${randomPart}`
}

/**
 * Hashes a token using SHA-256 (for storage in DB)
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

/**
 * Get all API keys for a project
 */
export async function getApiKeys(projectId: string): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data as ApiKey[]) || []
}

/**
 * Generate a new API key for a project
 * Returns the plain token - this is shown ONLY ONCE and cannot be retrieved later
 */
export async function generateApiKey(
  projectId: string,
  name: string
): Promise<{ apiKey: ApiKey; plainToken: string }> {
  // Generate random token
  const plainToken = generateToken()

  // Hash for storage
  const tokenHash = await hashToken(plainToken)

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('Not authenticated')
  }

  // Insert into DB (hash only, never store plain)
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      project_id: projectId,
      user_id: user.id,
      name,
      token_hash: tokenHash,
    })
    .select()
    .single()

  if (error) {
    // Human-friendly error for unique constraint violation
    if (error.message.includes('unique') || error.code === '23505') {
      throw new Error('You already have an API key for this project. Delete the existing one first or regenerate it.')
    }
    throw new Error(error.message)
  }

  return { apiKey: data as ApiKey, plainToken }
}

/**
 * Regenerate an API key: deletes old key, creates new one
 * Returns the new plain token - shown ONLY ONCE
 */
export async function regenerateApiKey(
  keyId: string
): Promise<{ apiKey: ApiKey; plainToken: string }> {
  // Get the existing key to find its project_id and user_id
  const { data: existingKey, error: fetchError } = await supabase
    .from('api_keys')
    .select('project_id, user_id')
    .eq('id', keyId)
    .single()

  if (fetchError || !existingKey) {
    throw new Error('API key not found')
  }

  // Delete the old key
  const { error: deleteError } = await supabase
    .from('api_keys')
    .delete()
    .eq('id', keyId)

  if (deleteError) {
    throw new Error(deleteError.message)
  }

  // Generate new token
  const plainToken = generateToken()
  const tokenHash = await hashToken(plainToken)

  // Create new key with same project_id and user_id but new token
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      project_id: existingKey.project_id,
      user_id: existingKey.user_id,
      name: 'API Key', // Name stays the same (or could be updated)
      token_hash: tokenHash,
    })
    .select()
    .single()

  if (error) {
    // Human-friendly error for unique constraint violation
    if (error.message.includes('unique') || error.code === '23505') {
      throw new Error('You already have an API key for this project. Delete the existing one first.')
    }
    throw new Error(error.message)
  }

  return { apiKey: data as ApiKey, plainToken }
}

/**
 * Delete an API key
 */
export async function deleteApiKey(keyId: string): Promise<void> {
  const { error } = await supabase
    .from('api_keys')
    .delete()
    .eq('id', keyId)

  if (error) {
    throw new Error(error.message)
  }
}
