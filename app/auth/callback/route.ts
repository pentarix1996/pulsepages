import type { NextRequest } from 'next/server'
import { linkErrorCode } from '@/components/auth/errors'
import { failedLinkRedirect, signedInRedirect } from '@/components/auth/redirects'
import { safeNext } from '@/components/auth/safe-next'
import { createClient } from '@/lib/supabase/server'

/**
 * PKCE return URL for magic links, sign-up confirmations, password resets, email changes and SSO:
 * exchanges `?code=` for a session (cookies) and continues to a safe `?next=` path.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const next = safeNext(params.get('next'))
  const providerError = params.get('error_code') ?? params.get('error')
  if (providerError) {
    const reason = params.get('error') === 'access_denied' && !params.get('error_code') ? 'access_denied' : linkErrorCode({ code: providerError, message: params.get('error_description') })
    return failedLinkRedirect(request, next, reason)
  }

  const code = params.get('code')
  const supabase = await createClient()
  if (!code) {
    // The first of two confirmation links of an email change carries no code; the person is still signed in.
    const { data } = await supabase.auth.getUser()
    if (data.user && next.startsWith('/settings/account')) return signedInRedirect(request, supabase, '/settings/account?email_change=confirm_other')
    return failedLinkRedirect(request, next, 'link_invalid')
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return failedLinkRedirect(request, next, linkErrorCode(error))
  return signedInRedirect(request, supabase, next)
}
