// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { accessCookieHeaders, accessCookieName, clearAccessCookieHeaders, hasSupabaseSessionCookie, isAccessToken, serializeAccessCookie } from '@/lib/status-page/access-cookie'
import { clientIp, ipAllowed, ipMatchesCidr, parseCidr } from '@/lib/status-page/cidr'
import { accessExchangeHref, bareHost, isCustomDomainRequest, PAGE_PATHS, pageHref, pageUrl, safeNextPath, signInUrl, type PageLocation } from '@/lib/status-page/links'

const UPVANE: PageLocation = { organizationSlug: 'quillbase', projectSlug: 'status', customDomain: null, onCustomDomain: false }
const DOMAIN: PageLocation = { organizationSlug: 'quillbase', projectSlug: 'status', customDomain: 'status.quillbase.io', onCustomDomain: true }
const APP = 'https://app.upvane.com/'

describe('page links', () => {
  it('builds relative links under /status on the Upvane host and at the root on a custom domain', () => {
    expect(pageHref(UPVANE)).toBe('/status/quillbase/status')
    expect(pageHref(UPVANE, PAGE_PATHS.history)).toBe('/status/quillbase/status/history')
    expect(pageHref(UPVANE, '?subscribe=confirmed')).toBe('/status/quillbase/status?subscribe=confirmed')
    expect(pageHref(DOMAIN)).toBe('/')
    expect(pageHref(DOMAIN, PAGE_PATHS.incident('a b'))).toBe('/incidents/a%20b')
    expect(pageHref(DOMAIN, '?x=1')).toBe('/?x=1')
  })

  it('prefers the verified custom domain for absolute URLs', () => {
    expect(pageUrl(UPVANE, APP, PAGE_PATHS.rss)).toBe('https://app.upvane.com/status/quillbase/status/feed.rss')
    expect(pageUrl({ ...UPVANE, customDomain: 'status.quillbase.io' }, APP, PAGE_PATHS.rss)).toBe('https://status.quillbase.io/feed.rss')
    expect(pageUrl(DOMAIN, APP, '?a=1')).toBe('https://status.quillbase.io/?a=1')
  })

  it('sends sign-in to the Upvane host with the page as next', () => {
    expect(signInUrl(DOMAIN, APP, '/history')).toBe('https://app.upvane.com/login?next=%2Fstatus%2Fquillbase%2Fstatus%2Fhistory')
  })

  it('encodes access exchange links', () => {
    expect(accessExchangeHref(UPVANE, 'spat_abc', '')).toBe('/api/public/status/quillbase/status/access?token=spat_abc&next=%2F')
  })
})

describe('safeNextPath', () => {
  it('keeps page-relative paths and strips the /status prefix', () => {
    expect(safeNextPath(UPVANE, '/history?before=2026-09-01')).toBe('/history?before=2026-09-01')
    expect(safeNextPath(UPVANE, '/status/quillbase/status/incidents/abc-123')).toBe('/incidents/abc-123')
    expect(safeNextPath(UPVANE, '/STATUS/Quillbase/Status')).toBe('/')
  })

  it('drops access tokens from the query', () => {
    expect(safeNextPath(UPVANE, '/history?access_token=spat_x&before=1&access=invalid')).toBe('/history?before=1')
  })

  it.each([null, '', 'https://evil.example/', '//evil.example/x', '/\\evil.example', '/settings', '/status/other/page/history', '/incidents/../../admin', 'x'.repeat(600)])('rejects %s', (raw) => {
    expect(safeNextPath(UPVANE, raw as string | null)).toBe('/')
  })
})

describe('custom domain detection', () => {
  it('normalises Host headers', () => {
    expect(bareHost('Status.Quillbase.io:443')).toBe('status.quillbase.io')
    expect(bareHost('a.example, b.example')).toBe('a.example')
    expect(bareHost('[::1]:3000')).toBe('[::1]')
    expect(bareHost('')).toBeNull()
  })

  it('only trusts the header when it matches the host and the verified domain', () => {
    expect(isCustomDomainRequest({ headerDomain: 'status.quillbase.io', host: 'status.quillbase.io', projectDomain: 'status.quillbase.io' })).toBe(true)
    expect(isCustomDomainRequest({ headerDomain: 'status.quillbase.io', host: 'app.upvane.com', projectDomain: 'status.quillbase.io' })).toBe(false)
    expect(isCustomDomainRequest({ headerDomain: 'evil.example', host: 'evil.example', projectDomain: 'status.quillbase.io' })).toBe(false)
    expect(isCustomDomainRequest({ headerDomain: null, host: 'status.quillbase.io', projectDomain: 'status.quillbase.io' })).toBe(false)
  })
})

describe('IP allow-lists', () => {
  it('matches IPv4 and IPv6 ranges and single hosts', () => {
    expect(ipMatchesCidr('203.0.113.7', '203.0.113.0/24')).toBe(true)
    expect(ipMatchesCidr('203.0.114.7', '203.0.113.0/24')).toBe(false)
    expect(ipMatchesCidr('2001:db8::1', '2001:db8::/32')).toBe(true)
    expect(ipMatchesCidr('198.51.100.4', '198.51.100.4')).toBe(true)
    expect(ipMatchesCidr('10.1.2.3', '0.0.0.0/0')).toBe(true)
  })

  it('treats IPv4-mapped IPv6 clients as IPv4 and accepts mapped ranges', () => {
    expect(ipAllowed('::ffff:203.0.113.7', ['203.0.113.0/24'])).toBe(true)
    expect(ipAllowed('203.0.113.7', ['::ffff:203.0.113.0/120'])).toBe(true)
    expect(ipAllowed('[2001:db8::5]:443', ['2001:db8::/64'])).toBe(true)
  })

  it('never matches invalid input', () => {
    expect(parseCidr('203.0.113.0/33')).toBeNull()
    expect(parseCidr('203.0.113.0/24/1')).toBeNull()
    expect(parseCidr('not-an-ip')).toBeNull()
    expect(ipAllowed('203.0.113.7', ['garbage', '10.0.0.0/8'])).toBe(false)
    expect(ipAllowed(null, ['0.0.0.0/0'])).toBe(false)
    expect(ipAllowed('203.0.113.7', [])).toBe(false)
  })

  it('reads the first forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7:5123, 10.0.0.1' }))).toBe('203.0.113.7')
    expect(clientIp(new Headers({ 'x-real-ip': '2001:DB8::1' }))).toBe('2001:db8::1')
    expect(clientIp(new Headers())).toBeNull()
  })
})

describe('access cookies', () => {
  const PROJECT = '44444444-4444-4444-8444-444444444444'

  it('validates tokens', () => {
    expect(isAccessToken('spat_' + 'a'.repeat(43))).toBe(true)
    expect(isAccessToken('spat_short')).toBe(false)
    expect(isAccessToken('upv_live_' + 'a'.repeat(43))).toBe(false)
  })

  it('scopes one httpOnly cookie per page to the page and its public API', () => {
    const headers = accessCookieHeaders(PROJECT, 'spat_' + 'a'.repeat(20), UPVANE)
    expect(headers).toHaveLength(2)
    expect(headers[0]).toBe(`${accessCookieName(PROJECT)}=spat_${'a'.repeat(20)}; Path=/status/quillbase/status; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`)
    expect(headers[1]).toContain('Path=/api/public/status/quillbase/status;')
    expect(accessCookieHeaders(PROJECT, 'spat_x', DOMAIN)).toHaveLength(1)
    expect(clearAccessCookieHeaders(PROJECT, DOMAIN)[0]).toContain('Max-Age=0')
  })

  it('refuses values that could inject attributes', () => {
    expect(() => serializeAccessCookie({ name: 'x', value: 'a; Domain=evil', path: '/', maxAge: 1 })).toThrow()
  })

  it('recognises Supabase session cookies, chunked or not', () => {
    expect(hasSupabaseSessionCookie(['sb-127-auth-token.0'])).toBe(true)
    expect(hasSupabaseSessionCookie(['sb-abcd-auth-token'])).toBe(true)
    expect(hasSupabaseSessionCookie(['upv_access_x'])).toBe(false)
  })
})
