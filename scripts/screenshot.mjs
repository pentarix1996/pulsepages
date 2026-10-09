#!/usr/bin/env node
// Local visual check: signs in a seeded user through /api/dev/login and screenshots a page.
// Usage: node scripts/screenshot.mjs <path> <out.png> [--email owner@upvane.test] [--width 1440] [--height 900] [--full] [--anon] [--dark]
// Needs `next dev` on BASE_URL (default http://localhost:3000) with UPVANE_DEV_LOGIN=1 and the seed loaded.
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : true
}
const [path = '/projects', out = 'screenshot.png'] = args.filter((arg, index) => !arg.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--') && !['--full', '--anon', '--dark'].includes(args[index - 1])))
const base = process.env.BASE_URL ?? 'http://localhost:3000'
const width = Number(flag('width', 1440))
const height = Number(flag('height', 900))

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: flag('dark', false) ? 'dark' : 'light' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})
const target = flag('anon', false)
  ? `${base}${path}`
  : `${base}/api/dev/login?email=${encodeURIComponent(flag('email', 'owner@upvane.test'))}&next=${encodeURIComponent(path)}`
const response = await page.goto(target, { waitUntil: 'networkidle', timeout: 90_000 })
await page.waitForTimeout(Number(flag('wait', 600)))
await page.screenshot({ path: out, fullPage: Boolean(flag('full', false)) })
console.log(JSON.stringify({ url: page.url(), status: response?.status(), title: await page.title(), errors }, null, 2))
await browser.close()
