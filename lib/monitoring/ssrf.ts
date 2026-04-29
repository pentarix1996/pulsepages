import { lookup } from 'node:dns/promises'

interface UrlValidationSuccess {
  ok: true
  normalizedUrl: string
}

interface UrlValidationFailure {
  ok: false
  reason: string
}

type UrlValidationResult = UrlValidationSuccess | UrlValidationFailure

type DnsResolver = (hostname: string) => Promise<string[]>

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // current network
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local / metadata
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // TEST-NET-1
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // TEST-NET-2
  [0xcb007100, 24], // TEST-NET-3
  [0xe0000000, 4], // multicast/reserved
] as const

const BIGINT_ZERO = BigInt(0)
const BIGINT_ONE = BigInt(1)
const IPV6_GROUP_BITS = BigInt(16)
const IPV6_TOTAL_BITS = BigInt(128)

const BLOCKED_IPV6_RANGES: ReadonlyArray<readonly [bigint, number]> = [
  [BIGINT_ZERO, 128], // unspecified
  [BIGINT_ONE, 128], // loopback
  [BigInt('0x0064ff9b000000000000000000000000'), 96], // IPv4/IPv6 translation prefix
  [BigInt('0x01000000000000000000000000000000'), 64], // discard-only prefix
  [BigInt('0x20010000000000000000000000000000'), 32], // Teredo and related special-use space
  [BigInt('0x20010db8000000000000000000000000'), 32], // documentation
  [BigInt('0x20020000000000000000000000000000'), 16], // 6to4
  [BigInt('0xfc000000000000000000000000000000'), 7], // unique local
  [BigInt('0xfe800000000000000000000000000000'), 10], // link-local
  [BigInt('0xff000000000000000000000000000000'), 8], // multicast
] as const

export function validateMonitorUrl(rawUrl: string): UrlValidationResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'Invalid URL.' }
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'Only HTTPS URLs are allowed.' }
  if (url.username || url.password) return { ok: false, reason: 'Credentials in URLs are not allowed.' }
  if (url.hash) url.hash = ''

  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)]$/, '$1')
  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) return { ok: false, reason: 'Localhost targets are not allowed.' }
  if (isBlockedIPv4(hostname) || isBlockedIPv6(hostname)) return { ok: false, reason: 'Private, local, and reserved IP targets are not allowed.' }

  return { ok: true, normalizedUrl: url.toString() }
}

export async function validateMonitorUrlWithDns(rawUrl: string, resolveHostname: DnsResolver = resolveHostnameAddresses): Promise<UrlValidationResult> {
  const validation = validateMonitorUrl(rawUrl)
  if (!validation.ok) return validation

  const url = new URL(validation.normalizedUrl)
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)]$/, '$1')
  if (isIPv4Literal(hostname) || isIPv6Literal(hostname)) return validation

  let addresses: string[]
  try {
    addresses = await resolveHostname(hostname)
  } catch {
    return { ok: false, reason: 'Target hostname could not be resolved safely.' }
  }

  if (addresses.length === 0) return { ok: false, reason: 'Target hostname did not resolve to any IP address.' }
  if (addresses.some((address) => isBlockedIPAddress(address))) {
    return { ok: false, reason: 'Target hostname resolves to a private, local, or reserved IP address.' }
  }

  return validation
}

async function resolveHostnameAddresses(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

function isBlockedIPAddress(address: string): boolean {
  const hostname = address.toLowerCase().replace(/^\[(.*)]$/, '$1')
  return isBlockedIPv4(hostname) || isBlockedIPv6(hostname)
}

function isBlockedIPv4(hostname: string): boolean {
  const value = parseIPv4(hostname)
  if (value === null) return false

  return BLOCKED_IPV4_RANGES.some(([range, prefix]) => ipv4MatchesCidr(value, range, prefix))
}

function isBlockedIPv6(hostname: string): boolean {
  const mappedIPv4 = parseIPv4MappedIPv6(hostname)
  if (mappedIPv4) return isBlockedIPv4(mappedIPv4)

  const value = parseIPv6(hostname)
  if (value === null) return false

  return BLOCKED_IPV6_RANGES.some(([range, prefix]) => ipv6MatchesCidr(value, range, prefix))
}

function isIPv4Literal(hostname: string): boolean {
  return parseIPv4(hostname) !== null
}

function isIPv6Literal(hostname: string): boolean {
  return parseIPv6(hostname) !== null
}

function parseIPv4(hostname: string): number | null {
  const parts = hostname.split('.')
  if (parts.length !== 4 || !parts.every((part) => /^\d+$/.test(part))) return null

  const octets = parts.map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) return null
  return ((octets[0] * 256 ** 3) + (octets[1] * 256 ** 2) + (octets[2] * 256) + octets[3]) >>> 0
}

function ipv4MatchesCidr(value: number, range: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (range & mask)
}

function parseIPv4MappedIPv6(hostname: string): string | null {
  const normalized = hostname.toLowerCase()
  if (!normalized.includes('.')) return null
  const lastColon = normalized.lastIndexOf(':')
  if (lastColon === -1) return null
  const maybeIPv4 = normalized.slice(lastColon + 1)
  if (parseIPv4(maybeIPv4) === null) return null
  return maybeIPv4
}

function parseIPv6(hostname: string): bigint | null {
  if (!hostname.includes(':')) return null
  const normalized = hostname.toLowerCase()
  if (normalized.includes('.')) return parseIPv6WithEmbeddedIPv4(normalized)

  const halves = normalized.split('::')
  if (halves.length > 2) return null

  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null

  const missing = halves.length === 2 ? 8 - left.length - right.length : 0
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null

  const groups = [...left, ...Array<string>(missing).fill('0'), ...right]
  if (groups.length !== 8) return null

  return groups.reduce((accumulator, group) => (accumulator << IPV6_GROUP_BITS) + BigInt(Number.parseInt(group, 16)), BIGINT_ZERO)
}

function parseIPv6WithEmbeddedIPv4(hostname: string): bigint | null {
  const lastColon = hostname.lastIndexOf(':')
  if (lastColon === -1) return null
  const ipv4 = parseIPv4(hostname.slice(lastColon + 1))
  if (ipv4 === null) return null
  const high = Math.floor(ipv4 / 65536).toString(16)
  const low = (ipv4 % 65536).toString(16)
  return parseIPv6(`${hostname.slice(0, lastColon)}:${high}:${low}`)
}

function ipv6MatchesCidr(value: bigint, range: bigint, prefix: number): boolean {
  const prefixBits = BigInt(prefix)
  const mask = ((BIGINT_ONE << prefixBits) - BIGINT_ONE) << (IPV6_TOTAL_BITS - prefixBits)
  return (value & mask) === (range & mask)
}
