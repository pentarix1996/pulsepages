import type { Metadata } from 'next'
import { SecurityManager } from '@/components/panel/settings/SecurityManager'
import { panelContext } from '@/lib/panel/server'
import { settingsScope } from '../_lib/scope'

export const metadata: Metadata = { title: 'Security' }

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const ctx = await panelContext()
  const [{ required }, scope, factorsResult] = await Promise.all([searchParams, settingsScope(), ctx.db.auth.mfa.listFactors()])
  const factors = (factorsResult.data?.totp ?? [])
    .filter((factor) => factor.status === 'verified')
    .map((factor, index) => ({ id: factor.id, name: factor.friendly_name || `Authenticator app ${index + 1}`, created_at: factor.created_at }))
  const requiredBy = (scope?.organizations ?? []).filter((org) => org.require_2fa).map((org) => org.name)

  return <SecurityManager factors={factors} requiredBy={requiredBy} redirected={required === '1'} email={ctx.actor.type === 'user' ? ctx.actor.email : null} />
}
