// Environment for the Edge Functions (Deno only). Read on every call, so tests can stub Deno.env and secrets
// rotated with `supabase secrets set` apply to new workers without code changes.

/** Trimmed value, or undefined when unset, empty or not readable (no --allow-env). */
export function readEnv(name: string): string | undefined {
  try {
    const value = Deno.env.get(name)?.trim()
    return value ? value : undefined
  } catch {
    return undefined
  }
}

/** First variable of the list that is set. */
export function readFirstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name)
    if (value) return value
  }
  return undefined
}

/** URL of the Next app, without trailing slash (PUBLIC_APP_URL; NEXT_PUBLIC_APP_URL is accepted for local runs). */
export function publicAppUrl(): string | undefined {
  return readFirstEnv('PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_URL')?.replace(/\/+$/, '')
}

/** Base URL of this Supabase project (set by the platform in every Edge Function). */
export function supabaseUrl(): string | undefined {
  return readEnv('SUPABASE_URL')?.replace(/\/+$/, '')
}
