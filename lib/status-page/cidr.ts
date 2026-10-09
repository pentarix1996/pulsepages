// IP allow-lists for private status pages (projects.allowed_ips). IPv4 and IPv6 CIDRs; a bare address means a single
// host. IPv4-mapped IPv6 clients (::ffff:203.0.113.7) match IPv4 ranges. Pure.
import { parseIPv4, parseIPv6 } from '@shared/monitoring/ssrf.ts'

type ParsedAddress = { family: 4; value: bigint } | { family: 6; value: bigint }
type ParsedRange = { family: 4 | 6; network: bigint; prefix: number }

const IPV4_MAPPED_PREFIX = BigInt('0xffff00000000')
const IPV4_MAPPED_MASK = BigInt('0xffffffffffffffffffffffff00000000')

/** Strips brackets, IPv6 zone ids and a :port suffix on IPv4 ("203.0.113.7:51234"). */
export function cleanIp(raw: string): string {
  let value = raw.trim()
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(value)
  if (bracket) value = bracket[1]!
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value)
  if (v4WithPort) value = v4WithPort[1]!
  const zone = value.indexOf('%')
  if (zone !== -1) value = value.slice(0, zone)
  return value.toLowerCase()
}

export function parseIp(raw: string): ParsedAddress | null {
  const value = cleanIp(raw)
  const v4 = parseIPv4(value)
  if (v4 !== null) return { family: 4, value: BigInt(v4) }
  const v6 = parseIPv6(value)
  if (v6 === null) return null
  if ((v6 & IPV4_MAPPED_MASK) === IPV4_MAPPED_PREFIX) return { family: 4, value: v6 & BigInt(0xffffffff) }
  return { family: 6, value: v6 }
}

export function parseCidr(raw: string): ParsedRange | null {
  const [addressPart, prefixPart, extra] = raw.trim().split('/')
  if (extra !== undefined || !addressPart) return null
  const address = parseIp(addressPart)
  if (!address) return null
  // A mapped IPv6 range (::ffff:10.0.0.0/104) is an IPv4 range.
  const mapped = address.family === 4 && addressPart.includes(':')
  const max = address.family === 4 ? 32 : 128
  let prefix = max
  if (prefixPart !== undefined) {
    if (!/^\d{1,3}$/.test(prefixPart)) return null
    prefix = Number(prefixPart) - (mapped ? 96 : 0)
    if (prefix < 0 || prefix > max) return null
  }
  return { family: address.family, network: address.value, prefix }
}

function inRange(address: ParsedAddress, range: ParsedRange): boolean {
  if (address.family !== range.family) return false
  const bits = BigInt(range.family === 4 ? 32 : 128)
  const prefix = BigInt(range.prefix)
  if (prefix === BigInt(0)) return true
  const mask = ((BigInt(1) << prefix) - BigInt(1)) << (bits - prefix)
  return (address.value & mask) === (range.network & mask)
}

export function ipMatchesCidr(ip: string, cidr: string): boolean {
  const address = parseIp(ip)
  const range = parseCidr(cidr)
  return Boolean(address && range && inRange(address, range))
}

/** True when `ip` falls inside any of the ranges. Invalid entries never match. */
export function ipAllowed(ip: string | null | undefined, ranges: readonly string[] | null | undefined): boolean {
  if (!ip || !ranges || ranges.length === 0) return false
  const address = parseIp(ip)
  if (!address) return false
  return ranges.some((cidr) => {
    const range = typeof cidr === 'string' ? parseCidr(cidr) : null
    return range !== null && inRange(address, range)
  })
}

/** Client address as seen by the platform: the first X-Forwarded-For value, else X-Real-IP. */
export function clientIp(headers: Pick<Headers, 'get'>): string | null {
  const forwarded = headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  if (first) return cleanIp(first)
  const real = headers.get('x-real-ip')?.trim()
  return real ? cleanIp(real) : null
}
