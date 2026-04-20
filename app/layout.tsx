import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/lib/auth/provider'
import { StoreProvider } from '@/lib/store/provider'
import { ToastProvider } from '@/hooks/useToast'
import { ToastContainer } from '@/components/ui/Toast'
import '@/styles/globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-primary',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'PulsePages — Status Pages That Build Trust',
  description: 'Beautiful, real-time status pages for your services. Keep your users informed with a single URL. Set up in 30 seconds — no code required.',
  keywords: ['status page', 'uptime monitoring', 'incident management', 'SaaS'],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AuthProvider>
          <StoreProvider>
            <ToastProvider>
              {children}
              <ToastContainer />
            </ToastProvider>
          </StoreProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
