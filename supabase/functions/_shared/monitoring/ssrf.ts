// SSRF protection for monitor targets (spec §5, fixes M-1). Validates on save and before every request/redirect hop.
// Isomorphic: DNS resolution is injected (node:dns in Next, Deno.resolveDns in Edge Functions).

export type DnsResolver = (hostname: string) => Promise<string[]>

export type TargetValidation = { ok: true; hostname: string; url?: string } | { ok: false; reason: string }

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback', 'metadata', 'metadata.google.internal', 'instance-data'])
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.corp', '.private']

// [network, prefix]
const BLOCKED_IPV4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8 this network
  [0x0a000000, 8], // 10.0.0.0/8 private
  [0x64400000, 10], // 100.64.0.0/10 carrier-grade NAT
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local, cloud metadata
  [0xac100000, 12], // 172.16.0.0/12 private
  [0xc0000000, 24], // 192.0.0.0/24 IETF protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24 TEST-NET-1
  [0xc0586300, 24], // 192.88.99.0/24 6to4 relay anycast
  [0xc0a80000, 16], // 192.168.0.0/16 private
  [0xc6120000, 15], // 198.18.0.0/15 benchmarking
  [0xc6336400, 24], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 4], // 224.0.0.0/4 multicast
  [0xf0000000, 4], // 240.0.0.0/4 reserved, includes 255.255.255.255
]

const BLOCKED_IPV6: ReadonlyArray<readonly [bigint, number]> = [
  [BigInt(0), 96], // ::/96 unspecified, loopback and IPv4-compatible
  [BigInt('0x0064ff9b000000000000000000000000'), 96], // 64:ff9b::/96 NAT64
  [BigInt('0x0064ff9b000100000000000000000000'), 48], // 64:ff9b:1::/48 local-use NAT64
  [BigInt('0x01000000000000000000000000000000'), 64], // 100::/64 discard-only
  [BigInt('0x20010000000000000000000000000000'), 23], // 2001::/23 IETF protocol assignments (Teredo, ORCHID...)
  [BigInt('0x20010db8000000000000000000000000'), 32], // 2001:db8::/32 documentation
  [BigInt('0x20020000000000000000000000000000'), 16], // 2002::/16 6to4 (can embed private IPv4)
  [BigInt('0xfc000000000000000000000000000000'), 7], // fc00::/7 unique local
  [BigInt('0xfe800000000000000000000000000000'), 10], // fe80::/10 link-local
  [BigInt('0xfec00000000000000000000000000000'), 10], // fec0::/10 site-local (deprecated)
  [BigInt('0xff000000000000000000000000000000'), 8], // ff00::/8 multicast
]

const IPV4_MAPPED_PREFIX = BigInt('0x00000000000000000000ffff00000000')
const IPV4_MAPPED_MASK = BigInt('0xffffffffffffffffffffffff00000000')
const LOW_32_BITS = BigInt(0xffffffff)

export function stripBrackets(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[(.*)]$/, '$1').replace(/\.$/, '')
}

export function parseIPv4(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  if (octets.some((octet) => octet > 255)) return null
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]
}

export function parseIPv6(value: string): bigint | null {
  let input = value.toLowerCase()
  const zone = input.indexOf('%')
  if (zone !== -1) input = input.slice(0, zone)
  if (!input.includes(':')) return null

  // Embedded dotted IPv4 in the last 32 bits (::ffff:1.2.3.4, 64:ff9b::10.0.0.1).
  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':')
    const ipv4 = parseIPv4(input.slice(lastColon + 1))
    if (ipv4 === null) return null
    input = `${input.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`
  }

  const halves = input.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if ([...left, ...right].some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0
  if (halves.length === 1 && left.length !== 8) return null
  if (halves.length === 2 && missing < 1) return null
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right]
  if (groups.length !== 8) return null
  return groups.reduce((acc, group) => (acc << BigInt(16)) + BigInt(parseInt(group, 16)), BigInt(0))
}

function ipv4InRange(value: number, network: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return ((value & mask) >>> 0) === ((network & mask) >>> 0)
}

function ipv6InRange(value: bigint, network: bigint, prefix: number): boolean {
  const bits = BigInt(prefix)
  const mask = ((BigInt(1) << bits) - BigInt(1)) << (BigInt(128) - bits)
  return (value & mask) === (network & mask)
}

export function isBlockedIPv4(value: number): boolean {
  return BLOCKED_IPV4.some(([network, prefix]) => ipv4InRange(value, network, prefix))
}

export function isBlockedIPv6(value: bigint): boolean {
  // IPv4-mapped (::ffff:0:0/96), in dotted or hex form: judge the embedded IPv4 address.
  if ((value & IPV4_MAPPED_MASK) === IPV4_MAPPED_PREFIX) {
    return isBlockedIPv4(Number(value & LOW_32_BITS))
  }
  return BLOCKED_IPV6.some(([network, prefix]) => ipv6InRange(value, network, prefix))
}

/** True for literal addresses that must never be contacted. Hostnames return false (resolve them first). */
export function isBlockedAddress(address: string): boolean {
  const host = stripBrackets(address)
  const v4 = parseIPv4(host)
  if (v4 !== null) return isBlockedIPv4(v4)
  const v6 = parseIPv6(host)
  if (v6 !== null) return isBlockedIPv6(v6)
  return false
}

export function isIpLiteral(hostname: string): boolean {
  const host = stripBrackets(hostname)
  return parseIPv4(host) !== null || parseIPv6(host) !== null
}

/** Hostname rules that do not need DNS. */
export function validateHostname(rawHostname: string): TargetValidation {
  const hostname = stripBrackets(rawHostname)
  if (!hostname) return { ok: false, reason: 'Enter a hostname.' }
  if (hostname.length > 253) return { ok: false, reason: 'The hostname is too long.' }
  if (isIpLiteral(hostname)) {
    return isBlockedAddress(hostname) ? { ok: false, reason: 'Private, local and reserved IP addresses are not allowed.' } : { ok: true, hostname }
  }
  if (!/^[a-z0-9_]([a-z0-9_-]{0,62})(\.[a-z0-9_]([a-z0-9_-]{0,62}))*$/.test(hostname)) {
    return { ok: false, reason: 'The hostname is not valid.' }
  }
  if (!hostname.includes('.')) return { ok: false, reason: 'Use a fully qualified domain name, such as api.example.com.' }
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: 'Local and internal hostnames are not allowed.' }
  }
  return { ok: true, hostname }
}

/** URL rules that do not need DNS: https only, no credentials, public hostname. */
export function validateMonitorUrl(rawUrl: string, options: { allowHttp?: boolean } = {}): TargetValidation {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return { ok: false, reason: 'Enter a valid URL, starting with https://.' }
  }
  const allowed = options.allowHttp ? ['https:', 'http:'] : ['https:']
  if (!allowed.includes(url.protocol)) return { ok: false, reason: 'Only https:// URLs can be monitored.' }
  if (url.username || url.password) return { ok: false, reason: 'Put credentials in a secret header, not in the URL.' }
  url.hash = ''
  const host = validateHostname(url.hostname)
  if (!host.ok) return host
  return { ok: true, hostname: host.hostname, url: url.toString() }
}

/** Resolves the hostname and rejects it if any address is private or reserved. */
export async function validateResolvedHost(hostname: string, resolve: DnsResolver): Promise<TargetValidation & { addresses?: string[] }> {
  const host = validateHostname(hostname)
  if (!host.ok) return host
  if (isIpLiteral(host.hostname)) return { ...host, addresses: [host.hostname] }
  let addresses: string[]
  try {
    addresses = await resolve(host.hostname)
  } catch {
    return { ok: false, reason: `Could not resolve ${host.hostname}.` }
  }
  if (addresses.length === 0) return { ok: false, reason: `${host.hostname} has no A or AAAA records.` }
  if (addresses.some((address) => isBlockedAddress(address))) {
    return { ok: false, reason: `${host.hostname} resolves to a private or reserved address.` }
  }
  return { ok: true, hostname: host.hostname, addresses }
}

export async function validateMonitorUrlWithDns(rawUrl: string, resolve: DnsResolver): Promise<TargetValidation> {
  const base = validateMonitorUrl(rawUrl)
  if (!base.ok) return base
  const resolved = await validateResolvedHost(base.hostname, resolve)
  if (!resolved.ok) return resolved
  return base
}
