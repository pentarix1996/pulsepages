import type { ReactNode } from 'react'
import '@/styles/panel.css'
import '@/styles/panel/settings.css'

/** Sign in, sign up, second factor and password reset: one centered card on the ink background. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth">{children}</main>
}
