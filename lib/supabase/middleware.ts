import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Refreshes the Supabase session cookies for this request (proxy.ts). `requestHeaders` are forwarded to the app. */
export async function updateSession(request: NextRequest, requestHeaders?: Headers) {
  const forward = () => NextResponse.next({ request: requestHeaders ? { headers: requestHeaders } : request })
  let supabaseResponse = forward()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          if (requestHeaders) {
            requestHeaders.set('cookie', request.cookies.toString())
          }
          supabaseResponse = forward()
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
          Object.entries(headers ?? {}).forEach(([key, value]) => supabaseResponse.headers.set(key, value))
        },
      },
    },
  )

  const { data } = await supabase.auth.getClaims()
  return { user: data?.claims ?? null, supabaseResponse }
}
