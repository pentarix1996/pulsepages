import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Local development only: signs in a seeded user (supabase/seed.sql) so screenshots and manual checks do not need
 * the login form. Disabled unless NODE_ENV is not production AND UPVANE_DEV_LOGIN=1.
 * GET /api/dev/login?email=owner@upvane.test&next=/projects
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' || process.env.UPVANE_DEV_LOGIN !== '1') {
    return new Response('Not found', { status: 404 })
  }
  const email = request.nextUrl.searchParams.get('email') ?? 'owner@upvane.test'
  const next = request.nextUrl.searchParams.get('next') ?? '/projects'
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password: 'upvane-demo-1' })
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return NextResponse.redirect(new URL(next.startsWith('/') ? next : '/projects', request.url))
}
