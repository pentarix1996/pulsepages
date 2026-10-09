// Evaluates probe responses against a monitor's expectations. Pure functions, used by monitor-probe and by the
// "test this monitor" preview in the panel.
import type { Assertion, AssertionOperator, EvaluationOutcome, HttpMonitorConfig } from './types.ts'

export const DEFAULT_EXPECTED_STATUS_CODES = ['200-399']
export const MAX_BODY_BYTES = 1024 * 1024

export interface HttpResponseSnapshot {
  status: number
  headers: Record<string, string>
  bodyText: string | null
  latencyMs: number
}

/** Accepts 200, "200", "2xx", "200-299". Unknown patterns never match. */
export function statusMatches(status: number, patterns: Array<number | string> | null | undefined): boolean {
  const list = patterns && patterns.length > 0 ? patterns : DEFAULT_EXPECTED_STATUS_CODES
  return list.some((pattern) => {
    if (typeof pattern === 'number') return status === pattern
    const value = String(pattern).trim().toLowerCase()
    if (/^\d{3}$/.test(value)) return status === Number(value)
    const family = /^([1-5])xx$/.exec(value)
    if (family) return Math.floor(status / 100) === Number(family[1])
    const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(value)
    if (range) return status >= Number(range[1]) && status <= Number(range[2])
    return false
  })
}

export function describeStatusPatterns(patterns: Array<number | string> | null | undefined): string {
  const list = patterns && patterns.length > 0 ? patterns : DEFAULT_EXPECTED_STATUS_CODES
  return list.map(String).join(', ')
}

/** Reads `a.b[0].c`, `$.a.b`, `items.0.name`. Returns undefined when the path does not exist. */
export function readJsonPath(document: unknown, path: string | null | undefined): unknown {
  if (!path || path === '$') return document
  const normalized = path.trim().replace(/^\$\.?/, '')
  if (normalized === '') return document
  const segments: Array<string | number> = []
  const pattern = /([^.[\]]+)|\[(\d+)\]|\["([^"]*)"\]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(normalized)) !== null) {
    if (match[2] !== undefined) segments.push(Number(match[2]))
    else if (match[3] !== undefined) segments.push(match[3])
    else if (match[1] !== undefined) segments.push(/^\d+$/.test(match[1]) ? Number(match[1]) : match[1])
  }
  let current: unknown = document
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[segment]
    } else {
      if (typeof current !== 'object' || Array.isArray(current)) return undefined
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
      current = (current as Record<string, unknown>)[segment]
    }
  }
  return current
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function toComparableString(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function compareValues(actual: unknown, operator: AssertionOperator, expected: unknown): boolean {
  switch (operator) {
    case 'exists':
      return actual !== undefined
    case 'not_exists':
      return actual === undefined
    case 'equals':
    case 'not_equals': {
      const a = toNumber(actual)
      const b = toNumber(expected)
      const equal = a !== null && b !== null ? a === b : toComparableString(actual) === toComparableString(expected)
      return operator === 'equals' ? actual !== undefined && equal : actual === undefined || !equal
    }
    case 'contains':
    case 'not_contains': {
      let contains = false
      if (Array.isArray(actual)) {
        contains = actual.some((item) => toComparableString(item) === toComparableString(expected))
      } else if (actual !== undefined && actual !== null) {
        contains = toComparableString(actual).includes(toComparableString(expected))
      }
      return operator === 'contains' ? contains : !contains
    }
    case 'greater_than':
    case 'less_than':
    case 'greater_or_equal':
    case 'less_or_equal': {
      const a = toNumber(actual)
      const b = toNumber(expected)
      if (a === null || b === null) return false
      if (operator === 'greater_than') return a > b
      if (operator === 'less_than') return a < b
      if (operator === 'greater_or_equal') return a >= b
      return a <= b
    }
    default:
      return false
  }
}

const OPERATOR_TEXT: Record<AssertionOperator, string> = {
  equals: 'to equal',
  not_equals: 'not to equal',
  contains: 'to contain',
  not_contains: 'not to contain',
  greater_than: 'to be greater than',
  less_than: 'to be less than',
  greater_or_equal: 'to be at least',
  less_or_equal: 'to be at most',
  exists: 'to exist',
  not_exists: 'not to exist',
}

function describeAssertionTarget(assertion: Assertion): string {
  switch (assertion.source) {
    case 'status_code':
      return 'Status code'
    case 'header':
      return `Header ${assertion.path ?? ''}`.trim()
    case 'json':
      return `JSON ${assertion.path || '$'}`
    case 'body':
      return 'Body'
    case 'response_time':
      return 'Response time'
    default:
      return 'Value'
  }
}

export function describeAssertionFailure(assertion: Assertion, actual: unknown): string {
  const expectation = OPERATOR_TEXT[assertion.operator] ?? assertion.operator
  const expected = assertion.operator === 'exists' || assertion.operator === 'not_exists' ? '' : ` ${toComparableString(assertion.value)}`
  const shown = actual === undefined ? 'missing' : truncate(toComparableString(actual), 80)
  return `${describeAssertionTarget(assertion)} expected ${expectation}${expected}, got ${shown}.`
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function parseJsonSafely(text: string | null): { ok: true; value: unknown } | { ok: false } {
  if (text === null) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

export function evaluateAssertion(assertion: Assertion, response: HttpResponseSnapshot, json: { ok: true; value: unknown } | { ok: false } | null): { passed: boolean; actual: unknown } {
  let actual: unknown
  switch (assertion.source) {
    case 'status_code':
      actual = response.status
      break
    case 'response_time':
      actual = response.latencyMs
      break
    case 'header': {
      const name = (assertion.path ?? '').toLowerCase()
      actual = Object.prototype.hasOwnProperty.call(response.headers, name) ? response.headers[name] : undefined
      break
    }
    case 'body':
      actual = response.bodyText ?? undefined
      break
    case 'json': {
      const parsed = json ?? parseJsonSafely(response.bodyText)
      actual = parsed.ok ? readJsonPath(parsed.value, assertion.path) : undefined
      break
    }
    default:
      actual = undefined
  }
  return { passed: compareValues(actual, assertion.operator, assertion.value), actual }
}

/** Status code → keyword → assertions → latency. The worst failure wins; latency alone only degrades. */
export function evaluateHttpResponse(config: Pick<HttpMonitorConfig, 'expected_status_codes' | 'assertions' | 'latency_threshold_ms' | 'keyword' | 'keyword_mode' | 'case_sensitive'>, response: HttpResponseSnapshot, options: { keywordCheck?: boolean } = {}): EvaluationOutcome {
  const failures: string[] = []
  let status: EvaluationOutcome['status'] = 'up'

  if (!statusMatches(response.status, config.expected_status_codes)) {
    failures.push(`Status ${response.status} is not ${describeStatusPatterns(config.expected_status_codes)}.`)
    status = 'down'
  }

  if (options.keywordCheck && config.keyword) {
    const body = response.bodyText ?? ''
    const haystack = config.case_sensitive ? body : body.toLowerCase()
    const needle = config.case_sensitive ? config.keyword : config.keyword.toLowerCase()
    const found = haystack.includes(needle)
    const wantMissing = config.keyword_mode === 'not_contains'
    if (found === wantMissing) {
      failures.push(wantMissing ? `The response contains "${truncate(config.keyword, 60)}".` : `The response does not contain "${truncate(config.keyword, 60)}".`)
      status = 'down'
    }
  }

  const assertions = Array.isArray(config.assertions) ? config.assertions : []
  if (assertions.length > 0) {
    const json = assertions.some((assertion) => assertion.source === 'json') ? parseJsonSafely(response.bodyText) : null
    for (const assertion of assertions) {
      const { passed, actual } = evaluateAssertion(assertion, response, json)
      if (passed) continue
      failures.push(describeAssertionFailure(assertion, actual))
      const outcome = assertion.on_fail === 'degraded' ? 'degraded' : 'down'
      if (outcome === 'down') status = 'down'
      else if (status === 'up') status = 'degraded'
    }
  }

  const threshold = config.latency_threshold_ms
  if (typeof threshold === 'number' && threshold > 0 && response.latencyMs > threshold) {
    failures.push(`Responded in ${Math.round(response.latencyMs)} ms, slower than ${threshold} ms.`)
    if (status === 'up') status = 'degraded'
  }

  return { status, error: failures[0] ?? null, failures }
}

/** DNS answers vs expected values (case-insensitive, trailing dots ignored). */
export function evaluateDnsAnswers(answers: string[], expected: string[] | null | undefined, match: 'any' | 'all' = 'any'): EvaluationOutcome {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\.$/, '')
  if (answers.length === 0) return { status: 'down', error: 'The record has no answers.', failures: ['The record has no answers.'] }
  const wanted = (expected ?? []).map(normalize).filter(Boolean)
  if (wanted.length === 0) return { status: 'up', error: null, failures: [] }
  const got = new Set(answers.map(normalize))
  const present = wanted.filter((value) => got.has(value))
  const ok = match === 'all' ? present.length === wanted.length : present.length > 0
  if (ok) return { status: 'up', error: null, failures: [] }
  const message = `Expected ${match === 'all' ? 'all of' : 'one of'} ${wanted.join(', ')}, got ${[...got].join(', ')}.`
  return { status: 'down', error: message, failures: [message] }
}

/** TLS expiry: expired → down; inside warn window → degraded. */
export function evaluateTlsExpiry(expiresAt: Date, now: Date, warnDays = 14): EvaluationOutcome {
  const msLeft = expiresAt.getTime() - now.getTime()
  const daysLeft = Math.floor(msLeft / 86_400_000)
  if (msLeft <= 0) {
    const message = `The certificate expired on ${expiresAt.toISOString().slice(0, 10)}.`
    return { status: 'down', error: message, failures: [message] }
  }
  if (daysLeft < warnDays) {
    const message = `The certificate expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${expiresAt.toISOString().slice(0, 10)}).`
    return { status: 'degraded', error: message, failures: [message] }
  }
  return { status: 'up', error: null, failures: [] }
}
