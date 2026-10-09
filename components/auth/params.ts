// Search params of auth pages (Next passes string | string[] | undefined).

export type SearchParams = Record<string, string | string[] | undefined>

export function firstParam(params: SearchParams, key: string): string | null {
  const value = params[key]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first.length > 0 ? first : null
}
