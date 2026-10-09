// Probe regions = Supabase Edge Function regions. Mirror of SQL public.monitor_regions().

export interface ProbeRegion {
  id: string
  city: string
  country: string
  /** Short label for tight spaces such as region tiles. */
  short: string
  continent: 'Europe' | 'North America' | 'South America' | 'Asia Pacific'
}

export const PROBE_REGIONS: readonly ProbeRegion[] = [
  { id: 'eu-central-1', city: 'Frankfurt', country: 'Germany', short: 'FRA', continent: 'Europe' },
  { id: 'eu-west-1', city: 'Dublin', country: 'Ireland', short: 'DUB', continent: 'Europe' },
  { id: 'eu-west-2', city: 'London', country: 'United Kingdom', short: 'LON', continent: 'Europe' },
  { id: 'eu-west-3', city: 'Paris', country: 'France', short: 'PAR', continent: 'Europe' },
  { id: 'eu-central-2', city: 'Zurich', country: 'Switzerland', short: 'ZRH', continent: 'Europe' },
  { id: 'us-east-1', city: 'N. Virginia', country: 'United States', short: 'IAD', continent: 'North America' },
  { id: 'us-west-1', city: 'N. California', country: 'United States', short: 'SFO', continent: 'North America' },
  { id: 'us-west-2', city: 'Oregon', country: 'United States', short: 'PDX', continent: 'North America' },
  { id: 'ca-central-1', city: 'Montreal', country: 'Canada', short: 'YUL', continent: 'North America' },
  { id: 'sa-east-1', city: 'São Paulo', country: 'Brazil', short: 'GRU', continent: 'South America' },
  { id: 'ap-southeast-1', city: 'Singapore', country: 'Singapore', short: 'SIN', continent: 'Asia Pacific' },
  { id: 'ap-southeast-2', city: 'Sydney', country: 'Australia', short: 'SYD', continent: 'Asia Pacific' },
  { id: 'ap-northeast-1', city: 'Tokyo', country: 'Japan', short: 'NRT', continent: 'Asia Pacific' },
  { id: 'ap-northeast-2', city: 'Seoul', country: 'South Korea', short: 'ICN', continent: 'Asia Pacific' },
  { id: 'ap-south-1', city: 'Mumbai', country: 'India', short: 'BOM', continent: 'Asia Pacific' },
] as const

export const PROBE_REGION_IDS: readonly string[] = PROBE_REGIONS.map((region) => region.id)
export const DEFAULT_REGION = 'eu-central-1'

export function isProbeRegion(value: unknown): value is string {
  return typeof value === 'string' && PROBE_REGION_IDS.includes(value)
}

export function regionInfo(id: string): ProbeRegion | undefined {
  return PROBE_REGIONS.find((region) => region.id === id)
}

export function regionLabel(id: string): string {
  const region = regionInfo(id)
  return region ? `${region.city}` : id
}

/** Sensible default spread for a plan that allows `count` regions: one per continent first. */
export function suggestedRegions(count: number): string[] {
  const order = ['eu-central-1', 'us-east-1', 'ap-southeast-1', 'us-west-2', 'eu-west-2', 'sa-east-1', 'ap-northeast-1', 'ap-southeast-2', 'ca-central-1', 'ap-south-1', 'eu-west-1', 'eu-west-3', 'eu-central-2', 'us-west-1', 'ap-northeast-2']
  if (count === -1) return [...order]
  return order.slice(0, Math.max(1, count))
}
