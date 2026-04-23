// proxy.ts
import { updateSession } from '@/lib/supabase/middleware'
import { NextResponse, type NextRequest } from 'next/server'

const protectedRoutes = ['/dashboard', '/project', '/incidents', '/settings']
const authRoutes = ['/login', '/register']

function withSupabaseCookies(
  response: NextResponse,
  supabaseResponse: NextResponse
) {
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie)
  })

  return response
}

export async function proxy(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isProtected = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  )

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withSupabaseCookies(NextResponse.redirect(url), supabaseResponse)
  }

  const isAuthRoute = authRoutes.some((route) => pathname === route)

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return withSupabaseCookies(NextResponse.redirect(url), supabaseResponse)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}