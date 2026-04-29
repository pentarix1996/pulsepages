import { describe, expect, it } from 'vitest'
import { validateMonitorUrl, validateMonitorUrlWithDns } from '@/lib/monitoring/ssrf'

describe('validateMonitorUrl', () => {
  it('accepts public https URLs', () => {
    const result = validateMonitorUrl('https://api.example.com/health')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.normalizedUrl).toBe('https://api.example.com/health')
  })

  it('rejects non-https URLs and credentials', () => {
    expect(validateMonitorUrl('http://api.example.com/health').ok).toBe(false)
    expect(validateMonitorUrl('https://user:pass@example.com/health').ok).toBe(false)
  })

  it('rejects localhost and private IPv4 literal URLs', () => {
    expect(validateMonitorUrl('https://localhost/health').ok).toBe(false)
    expect(validateMonitorUrl('https://127.0.0.1/health').ok).toBe(false)
    expect(validateMonitorUrl('https://10.0.0.8/health').ok).toBe(false)
    expect(validateMonitorUrl('https://172.16.0.1/health').ok).toBe(false)
    expect(validateMonitorUrl('https://192.168.1.10/health').ok).toBe(false)
    expect(validateMonitorUrl('https://169.254.169.254/latest/meta-data').ok).toBe(false)
  })

  it('rejects IPv6 loopback, unique local, and link-local literals', () => {
    expect(validateMonitorUrl('https://[::1]/health').ok).toBe(false)
    expect(validateMonitorUrl('https://[fc00::1]/health').ok).toBe(false)
    expect(validateMonitorUrl('https://[fe80::1]/health').ok).toBe(false)
  })

  it('rejects hostnames that resolve to private IP addresses', async () => {
    const result = await validateMonitorUrlWithDns('https://internal.example.com/health', async () => ['10.0.0.8'])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected DNS validation to reject private resolution.')
    expect(result.reason).toContain('resolves')
  })

  it('accepts hostnames that resolve only to public IP addresses', async () => {
    const result = await validateMonitorUrlWithDns('https://api.example.com/health', async () => ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])

    expect(result.ok).toBe(true)
  })
})
