import 'server-only'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. See .env.example.`)
  return value
}

/** Server-side configuration. Read lazily so builds and tests do not need every variable. */
export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  serviceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  /** Public URL of this app, without trailing slash. */
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  /** Base64 of 32 random bytes; encrypts monitor headers, channel secrets and subscriber targets. */
  secretsKey: () => required('UPVANE_SECRETS_KEY'),
  resendApiKey: () => process.env.RESEND_API_KEY ?? null,
  emailFrom: () => process.env.ALERTS_EMAIL_FROM ?? 'Upvane <alerts@upvane.com>',
  billingMode: () => (process.env.BILLING_MODE ?? 'demo') as 'demo' | 'stripe',
  monitorRunnerSecret: () => process.env.MONITOR_RUNNER_SECRET ?? null,
  vercel: () => ({
    token: process.env.VERCEL_API_TOKEN ?? null,
    projectId: process.env.VERCEL_PROJECT_ID ?? null,
    teamId: process.env.VERCEL_TEAM_ID ?? null,
  }),
  customDomainTarget: () => process.env.CUSTOM_DOMAIN_CNAME_TARGET ?? 'cname.upvane.dev',
  /** Hostname that serves the public API (api.<domain>), rewritten to /api/v1 by proxy.ts. */
  apiHost: () => process.env.UPVANE_API_HOST ?? null,
}
