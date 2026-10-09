// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  normalizeHostname,
  normalizeTimeZone,
  parseAllowedIp,
  projectCreateInput,
  projectUpdateInput,
  slugifyProjectName,
  uniqueProjectSlug,
} from '@/lib/domain/schemas/projects'

const issues = (input: unknown) => {
  const result = projectUpdateInput.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

describe('time zones', () => {
  it('accepts IANA names and fixes their case', () => {
    expect(normalizeTimeZone('Europe/Madrid')).toBe('Europe/Madrid')
    expect(normalizeTimeZone('europe/madrid')).toBe('Europe/Madrid')
    expect(normalizeTimeZone(' America/New_York ')).toBe('America/New_York')
    expect(normalizeTimeZone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires')
    expect(normalizeTimeZone('Asia/Kolkata')).toMatch(/^Asia\/(Kolkata|Calcutta)$/)
  })

  it('maps the UTC aliases to UTC', () => {
    for (const alias of ['UTC', 'utc', 'Etc/UTC', 'GMT', 'Zulu']) expect(normalizeTimeZone(alias)).toBe('UTC')
  })

  it('rejects offsets, abbreviations Intl does not know and garbage', () => {
    for (const value of ['+01:00', '-05:00', 'UTC+1', 'Mars/Olympus', '', 'Europe/', '../etc/passwd', 'Europe/Madrid; drop table', 'a'.repeat(80)]) {
      expect(normalizeTimeZone(value), value).toBeNull()
    }
  })

  it('validates through the update schema with a readable message', () => {
    expect(projectUpdateInput.parse({ timezone: 'asia/tokyo' }).timezone).toBe('Asia/Tokyo')
    expect(issues({ timezone: '+02:00' })).toEqual([{ path: 'timezone', message: 'Use an IANA time zone such as Europe/Madrid or America/New_York.' }])
  })
})

describe('allowed IPs', () => {
  it('accepts IPv4 and IPv6 addresses and CIDR blocks in canonical form', () => {
    expect(parseAllowedIp('203.0.113.7')).toEqual({ ok: true, value: '203.0.113.7' })
    expect(parseAllowedIp('203.0.113.7/32')).toEqual({ ok: true, value: '203.0.113.7' })
    expect(parseAllowedIp('10.0.0.0/8')).toEqual({ ok: true, value: '10.0.0.0/8' })
    expect(parseAllowedIp('0.0.0.0/0')).toEqual({ ok: true, value: '0.0.0.0/0' })
    expect(parseAllowedIp('2001:DB8::/32')).toEqual({ ok: true, value: '2001:db8::/32' })
    expect(parseAllowedIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual({ ok: true, value: '2001:db8::1' })
    expect(parseAllowedIp('2001:db8::1/128')).toEqual({ ok: true, value: '2001:db8::1' })
    expect(parseAllowedIp('::1')).toEqual({ ok: true, value: '::1' })
    expect(parseAllowedIp('::')).toEqual({ ok: true, value: '::' })
    expect(parseAllowedIp('fe80::/10')).toEqual({ ok: true, value: 'fe80::/10' })
    expect(parseAllowedIp('2001:db8:0:0:1:0:0:1')).toEqual({ ok: true, value: '2001:db8::1:0:0:1' })
    expect(parseAllowedIp('::ffff:192.0.2.1')).toEqual({ ok: true, value: '::ffff:c000:201' })
    expect(parseAllowedIp('64:ff9b::198.51.100.0/120')).toEqual({ ok: true, value: '64:ff9b::c633:6400/120' })
  })

  it('explains blocks with host bits set', () => {
    expect(parseAllowedIp('10.0.0.5/8')).toEqual({ ok: false, error: '10.0.0.5/8 has host bits set. Did you mean 10.0.0.0/8?' })
    expect(parseAllowedIp('192.168.1.130/25')).toEqual({ ok: false, error: '192.168.1.130/25 has host bits set. Did you mean 192.168.1.128/25?' })
    expect(parseAllowedIp('2001:db8::1/64')).toEqual({ ok: false, error: '2001:db8::1/64 has host bits set. Did you mean 2001:db8::/64?' })
  })

  it('rejects malformed addresses and prefixes', () => {
    for (const value of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.4/33', '1.2.3.4/', '1.2.3.4/08', '1.2.3.4/8/8', '2001:db8::1/129', '2001:db8:::1', '1::2::3', '1:2:3:4:5:6:7:8:9', '12345::', 'fe80::1%eth0', 'localhost', 'example.com', '']) {
      expect(parseAllowedIp(value).ok, value).toBe(false)
    }
  })

  it('validates the list with per-entry paths and removes duplicates', () => {
    expect(projectUpdateInput.parse({ allowed_ips: ['10.0.0.0/8', ' 10.0.0.0/8 ', '2001:DB8::1'] }).allowed_ips).toEqual(['10.0.0.0/8', '2001:db8::1'])
    expect(issues({ allowed_ips: ['10.0.0.0/8', 'nope'] })).toEqual([{ path: 'allowed_ips.1', message: 'nope is not a valid IP address or CIDR block.' }])
    expect(issues({ allowed_ips: Array.from({ length: 201 }, (_, index) => `10.0.${Math.floor(index / 256)}.${index % 256}`) })[0]?.message).toBe('Use at most 200 entries.')
    expect(projectUpdateInput.parse({ allowed_ips: [] }).allowed_ips).toEqual([])
  })
})

describe('custom domain', () => {
  it('normalizes what people paste', () => {
    expect(normalizeHostname(' https://Status.Example.com/path?x=1 ')).toBe('status.example.com')
    expect(normalizeHostname('status.example.com.')).toBe('status.example.com')
    expect(projectUpdateInput.parse({ custom_domain: 'Status.Example.COM' }).custom_domain).toBe('status.example.com')
  })

  it('accepts null and empty to remove the domain', () => {
    expect(projectUpdateInput.parse({ custom_domain: null }).custom_domain).toBeNull()
    expect(projectUpdateInput.parse({ custom_domain: '' }).custom_domain).toBeNull()
    expect('custom_domain' in projectUpdateInput.parse({})).toBe(false)
  })

  it('rejects hosts that are not domains', () => {
    for (const value of ['localhost', '192.168.1.10', 'status_page.example.com', '-status.example.com', 'status.example.c', 'status.example.com:8080', `${'a'.repeat(64)}.example.com`]) {
      expect(projectUpdateInput.safeParse({ custom_domain: value }).success, value).toBe(false)
    }
  })
})

describe('other settings', () => {
  it('validates uptime weights', () => {
    expect(projectUpdateInput.parse({ uptime_weights: { partial_outage: 0.5, degraded: 0.1 } }).uptime_weights).toEqual({ partial_outage: 0.5, degraded: 0.1 })
    expect(issues({ uptime_weights: { partial_outage: 1.5, degraded: 0 } })[0]).toEqual({ path: 'uptime_weights.partial_outage', message: 'Use a weight between 0 and 1.' })
    expect(issues({ uptime_weights: { partial_outage: 0.2, degraded: 0.5 } })[0]).toEqual({ path: 'uptime_weights.degraded', message: 'Degraded cannot weigh more than a partial outage.' })
    expect(issues({ uptime_weights: { partial_outage: 0.3 } })[0]?.path).toBe('uptime_weights.degraded')
  })

  it('validates slugs like the database does', () => {
    expect(projectUpdateInput.parse({ slug: ' Status-EU ' }).slug).toBe('status-eu')
    for (const slug of ['a', '-status', 'status-', 'sta tus', 'státus', 'x'.repeat(65)]) {
      expect(projectUpdateInput.safeParse({ slug }).success, slug).toBe(false)
    }
  })

  it('validates branding, links and visibility', () => {
    const parsed = projectUpdateInput.parse({ brand_color: '#0e7490', support_url: 'mailto:help@example.com', logo_url: 'https://cdn.example.com/logo.svg', visibility: 'private', theme_default: 'dark' })
    expect(parsed.brand_color).toBe('#0E7490')
    expect(projectUpdateInput.parse({ logo_url: 'http://127.0.0.1:54321/storage/v1/object/public/branding/p/logo.png' }).logo_url).toContain('127.0.0.1')
    expect(projectUpdateInput.parse({ brand_color: '' }).brand_color).toBeNull()
    expect(projectUpdateInput.safeParse({ brand_color: 'teal' }).success).toBe(false)
    expect(projectUpdateInput.safeParse({ support_url: 'http://example.com' }).success).toBe(false)
    expect(projectUpdateInput.safeParse({ support_url: 'javascript:alert(1)' }).success).toBe(false)
    expect(projectUpdateInput.safeParse({ logo_url: 'http://evil.example/logo.png' }).success).toBe(false)
    expect(projectUpdateInput.safeParse({ visibility: 'internal' }).success).toBe(false)
  })

  it('drops fields the API does not let clients set', () => {
    const parsed = projectUpdateInput.parse({ name: 'Docs', custom_domain_status: 'verified', organization_id: '33333333-3333-4333-8333-333333333333' }) as Record<string, unknown>
    expect(parsed).toEqual({ name: 'Docs' })
  })

  it('requires a name on create', () => {
    expect(projectCreateInput.safeParse({ organization_id: '33333333-3333-4333-8333-333333333333' }).success).toBe(false)
    expect(projectCreateInput.parse({ name: '  Docs  ' }).name).toBe('Docs')
  })
})

describe('slug generation', () => {
  it('turns names into valid slugs', () => {
    expect(slugifyProjectName('Quillbase Status (EU)')).toBe('quillbase-status-eu')
    expect(slugifyProjectName('Café Ñandú')).toBe('cafe-nandu')
    expect(slugifyProjectName('Q')).toBe('q-status')
    expect(slugifyProjectName('!!!')).toBe('status')
    expect(slugifyProjectName('x'.repeat(100))).toHaveLength(60)
  })

  it('finds the first free slug in the organization', () => {
    expect(uniqueProjectSlug('status', [])).toBe('status')
    expect(uniqueProjectSlug('status', ['status', 'status-2'])).toBe('status-3')
    const long = 'a'.repeat(64)
    const next = uniqueProjectSlug(long, [long])
    expect(next).toHaveLength(64)
    expect(next.endsWith('-2')).toBe(true)
  })
})
