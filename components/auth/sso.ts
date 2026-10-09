// Single sign-on helpers shared by the login form and its tests. Pure.

const DOMAIN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** acme.com from "jane@acme.com", "@acme.com" or "acme.com"; null when it is not a domain. */
export function ssoDomainFrom(value: string): string | null {
  const domain = value.trim().toLowerCase().split('@').pop() ?? ''
  return DOMAIN.test(domain) ? domain : null
}
