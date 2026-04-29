import type { ComponentStatus } from '@/lib/types'
import { MONITOR_OPERATOR, type MonitorJsonRule } from './types'

const BLOCKED_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

interface RuleEvaluationResult {
  status: ComponentStatus
  matchedRuleIndex: number | null
}

export function getJsonPathValue(payload: unknown, path: string): unknown {
  const segments = parseJsonPath(path)
  if (segments.length === 0) return undefined

  let current: unknown = payload
  for (const segment of segments) {
    if (BLOCKED_PATH_KEYS.has(segment)) return undefined
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
      continue
    }
    if (typeof current !== 'object' || current === null || !(segment in current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

export function evaluateMonitorRules(payload: unknown, rules: MonitorJsonRule[], noMatchStatus: ComponentStatus): RuleEvaluationResult {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]
    const actual = getJsonPathValue(payload, rule.path)
    if (matchesRule(actual, rule)) {
      return { status: rule.targetStatus, matchedRuleIndex: index }
    }
  }

  return { status: noMatchStatus, matchedRuleIndex: null }
}

function parseJsonPath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
}

function matchesRule(actual: unknown, rule: MonitorJsonRule): boolean {
  if (rule.operator === MONITOR_OPERATOR.EXISTS) return actual !== undefined && actual !== null
  if (actual === undefined) return false

  if (rule.operator === MONITOR_OPERATOR.EQUALS) return valuesAreEqual(actual, rule.value)
  if (rule.operator === MONITOR_OPERATOR.NOT_EQUALS) return !valuesAreEqual(actual, rule.value)
  if (rule.operator === MONITOR_OPERATOR.CONTAINS) return stringValue(actual).includes(stringValue(rule.value ?? ''))
  if (rule.operator === MONITOR_OPERATOR.GREATER_THAN) return toNumber(actual) > toNumber(rule.value)
  if (rule.operator === MONITOR_OPERATOR.LESS_THAN) return toNumber(actual) < toNumber(rule.value)

  return false
}

function valuesAreEqual(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual.toLowerCase() === expected.toLowerCase()
  }

  return actual === expected
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : String(value)
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}
