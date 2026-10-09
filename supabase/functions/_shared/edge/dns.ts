// DNS through Deno.resolveDns: record lookups for DNS monitors and the A+AAAA resolver the SSRF checks need.
import type { DnsResolver } from '../monitoring/ssrf.ts'

/** One record lookup. Deno returns strings (A, AAAA, CNAME, NS), string[][] (TXT) or objects (MX, CAA, ...). */
export type RecordLookup = (hostname: string, recordType: string, signal?: AbortSignal) => Promise<unknown[]>

type ResolveDns = (query: string, recordType: Deno.RecordType, options?: { signal?: AbortSignal }) => Promise<unknown[]>

/** Deno.resolveDns, or null when the runtime does not expose it (then probes report an error instead of a down). */
export function systemRecordLookup(): RecordLookup | null {
  const resolveDns = (Deno as unknown as { resolveDns?: ResolveDns }).resolveDns
  if (typeof resolveDns !== 'function') return null
  return (hostname, recordType, signal) => resolveDns(hostname, recordType as Deno.RecordType, signal ? { signal } : undefined)
}

/** No record of that type (or no such name): Deno throws Deno.errors.NotFound for both. */
export function isDnsNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: unknown }).name === 'NotFound'
}

/** A + AAAA in parallel. Throws only when both lookups fail, so an IPv4-only host resolves fine. */
export function addressResolver(lookup: RecordLookup, signal?: AbortSignal): DnsResolver {
  return async (hostname) => {
    const [v4, v6] = await Promise.allSettled([lookup(hostname, 'A', signal), lookup(hostname, 'AAAA', signal)])
    if (v4.status === 'rejected' && v6.status === 'rejected') throw v4.reason
    const addresses = [...(v4.status === 'fulfilled' ? v4.value : []), ...(v6.status === 'fulfilled' ? v6.value : [])]
    return addresses.map(String)
  }
}
