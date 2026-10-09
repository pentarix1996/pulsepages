import type { Metadata, Viewport } from 'next'
import { Archivo, JetBrains_Mono } from 'next/font/google'
import { Providers } from '@/components/providers'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/ui.css'

const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Upvane — Status pages and monitoring for on-call teams', template: '%s · Upvane' },
  description:
    'Multi-region monitoring that confirms before it pages, incident updates your customers can follow, and status pages you manage as code.',
  applicationName: 'Upvane',
}

export const viewport: Viewport = {
  themeColor: '#0C1222',
  colorScheme: 'dark light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
