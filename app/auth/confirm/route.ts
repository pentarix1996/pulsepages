import type { EmailOtpType } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { linkErrorCode } from '@/components/auth/errors'
import { failedLinkRedirect, signedInRedirect } from '@/components/auth/redirects'
import { safeNext } from '@/components/auth/safe-next'
import { createClient } from '@/lib/supabase/server'

const TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

function defaultDestination(type: EmailOtpType): string {
  if (type === 'recovery') return '/reset-password'
  if (type === 'email_change') return '/settings/account'
  return '/projects'
}

/**
 * Email links built with `{{ .TokenHash }}` (custom Supabase email templates):
 * /auth/confirm?token_hash=…&type=signup|magiclink|recovery|email_change|invite|email&next=/path
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const tokenHash = params.get('token_hash')
  const type = params.get('type') as EmailOtpType | null
  const valid = type && TYPES.includes(type)
  const next = safeNext(params.get('next'), valid ? defaultDestination(type) : '/projects')
  if (!tokenHash || !valid) return failedLinkRedirect(request, next, 'link_invalid')

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) return failedLinkRedirect(request, next, linkErrorCode(error))
  return signedInRedirect(request, supabase, next)
}
