import type { Metadata } from 'next'
import { AccountManager } from '@/components/panel/settings/AccountManager'
import { getAccount } from '@/lib/domain/account'
import { guard, panelContext } from '@/lib/panel/server'

export const metadata: Metadata = { title: 'Account' }

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ email_change?: string }> }) {
  const ctx = await panelContext()
  const account = await guard(() => getAccount(ctx))
  const { email_change: emailChange } = await searchParams
  return <AccountManager account={account} confirmOther={emailChange === 'confirm_other'} />
}
