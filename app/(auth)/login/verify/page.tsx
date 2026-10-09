import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/AuthShell'
import { firstParam, type SearchParams } from '@/components/auth/params'
import { safeNext } from '@/components/auth/safe-next'
import { VerifyForm } from '@/components/auth/VerifyForm'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Two-factor authentication' }

export default async function VerifyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const next = safeNext(firstParam(await searchParams, 'next'))
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect(`/login?next=${encodeURIComponent(next)}`)

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (!aal || aal.nextLevel !== 'aal2' || aal.currentLevel === 'aal2') redirect(next)
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const totp = (factors?.totp ?? []).filter((factor) => factor.status === 'verified')
  if (totp.length === 0) redirect(next)

  return (
    <AuthShell title="Two-factor authentication" subtitle={`Enter the code from your authenticator app to finish signing in as ${userData.user.email ?? 'you'}.`}>
      <VerifyForm factors={totp.map((factor, index) => ({ id: factor.id, name: factor.friendly_name || `Authenticator app ${index + 1}` }))} next={next} />
    </AuthShell>
  )
}
