import { describe, expect, it } from 'vitest'
import { isBlockedAddress, parseIPv6, validateHostname, validateMonitorUrl, validateMonitorUrlWithDns } from '@shared/monitoring/ssrf.ts'

describe('validateMonitorUrl', () => {
  it('accepts public https URLs and drops the fragment', () => {
    const result = validateMonitorUrl('https://api.example.com/health#x')
    expect(result).toEqual({ ok: true, hostname: 'api.example.com', url: 'https://api.example.com/health' })
  })

  it('rejects http, other schemes and credentials', () => {
    expect(validateMonitorUrl('http://api.example.com/health').ok).toBe(false)
    expect(validateMonitorUrl('ftp://api.example.com').ok).toBe(false)
    expect(validateMonitorUrl('https://user:pass@example.com/health').ok).toBe(false)
  })

  it('rejects local and internal hostnames, and single-label hosts', () => {
    for (const url of ['https://localhost/', 'https://app.localhost/', 'https://printer.local/', 'https://metadata.google.internal/', 'https://intranet/', 'https://db.svc.internal/']) {
      expect(validateMonitorUrl(url).ok, url).toBe(false)
    }
  })

  it('rejects private, loopback, metadata and reserved IPv4 literals in any notation', () => {
    for (const url of [
      'https://127.0.0.1/',
      'https://10.0.0.8/',
      'https://172.16.0.1/',
      'https://192.168.1.10/',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.1.1/',
      'https://0.0.0.0/',
      'https://240.0.0.1/',
      'https://255.255.255.255/',
      'https://2130706433/', // 127.0.0.1 as an integer
      'https://0x7f.0.0.1/', // hex octet
      'https://017700000001/', // octal
    ]) {
      expect(validateMonitorUrl(url).ok, url).toBe(false)
    }
  })

  it('rejects IPv6 loopback, ULA, link-local, NAT64 and IPv4-mapped forms (M-1)', () => {
    for (const url of [
      'https://[::1]/',
      'https://[::]/',
      'https://[fc00::1]/',
      'https://[fd12:3456::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://[::ffff:7f00:1]/', // hex form of ::ffff:127.0.0.1
      'https://[::ffff:a9fe:a9fe]/', // 169.254.169.254
      'https://[64:ff9b::a00:1]/', // NAT64 to 10.0.0.1
      'https://[2002:a00:1::]/', // 6to4 of 10.0.0.1
    ]) {
      expect(validateMonitorUrl(url).ok, url).toBe(false)
    }
  })

  it('accepts public IP literals', () => {
    expect(validateMonitorUrl('https://93.184.216.34/').ok).toBe(true)
    expect(validateMonitorUrl('https://[2606:4700:4700::1111]/').ok).toBe(true)
    expect(validateMonitorUrl('https://[::ffff:8.8.8.8]/').ok).toBe(true)
  })
})

describe('isBlockedAddress', () => {
  it('judges IPv4-mapped IPv6 by the embedded address', () => {
    expect(isBlockedAddress('::ffff:10.1.2.3')).toBe(true)
    expect(isBlockedAddress('::ffff:0a01:0203')).toBe(true)
    expect(isBlockedAddress('::ffff:1.1.1.1')).toBe(false)
  })

  it('parses zone ids and compressed forms', () => {
    expect(parseIPv6('fe80::1%eth0')).not.toBeNull()
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true)
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(parseIPv6('1::2::3')).toBeNull()
  })
})

describe('validateHostname', () => {
  it('requires a fully qualified name', () => {
    expect(validateHostname('db').ok).toBe(false)
    expect(validateHostname('db.example.com').ok).toBe(true)
    expect(validateHostname('bad_host!.example.com').ok).toBe(false)
  })
})

describe('validateMonitorUrlWithDns', () => {
  it('rejects hostnames that resolve to private addresses (DNS rebinding at save time)', async () => {
    const result = await validateMonitorUrlWithDns('https://internal.example.com/health', async () => ['93.184.216.34', '10.0.0.8'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('resolves to a private')
  })

  it('accepts hostnames that resolve only to public addresses', async () => {
    const result = await validateMonitorUrlWithDns('https://api.example.com/health', async () => ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])
    expect(result.ok).toBe(true)
  })

  it('fails closed when DNS fails or returns nothing', async () => {
    expect((await validateMonitorUrlWithDns('https://api.example.com', async () => [])).ok).toBe(false)
    expect((await validateMonitorUrlWithDns('https://api.example.com', async () => { throw new Error('SERVFAIL') })).ok).toBe(false)
  })
})
