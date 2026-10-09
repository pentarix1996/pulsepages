import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_DESTINATION } from './safe-next'

const INVITE_PATH = /^\/invite\/(inv_[A-Za-z0-9]{20,128})$/

/** Where a failed email link or SSO round trip lands: the reset form for password links, else sign-in. */
export function failedLinkRedirect(request: NextRequest, next: string, reason: string): NextResponse {
  const target = new URL(next === '/reset-password' ? '/forgot-password' : '/login', request.nextUrl.origin)
  target.searchParams.set('error', reason)
  const invite = INVITE_PATH.exec(next)?.[1]
  if (invite) target.searchParams.set('invite', invite)
  else if (next !== DEFAULT_DESTINATION && next !== '/reset-password') target.searchParams.set('next', next)
  return NextResponse.redirect(target)
}

/** After a session is created: people with an authenticator app confirm their code first. */
export async function signedInRedirect(request: NextRequest, supabase: SupabaseClient, next: string): Promise<NextResponse> {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    const verify = new URL('/login/verify', request.nextUrl.origin)
    verify.searchParams.set('next', next)
    return NextResponse.redirect(verify)
  }
  return NextResponse.redirect(new URL(next, request.nextUrl.origin))
}
