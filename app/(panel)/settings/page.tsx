import { redirect } from 'next/navigation'

/** proxy.ts already sends /settings to /settings/account; this covers direct renders. */
export default function SettingsIndex() {
  redirect('/settings/account')
}
