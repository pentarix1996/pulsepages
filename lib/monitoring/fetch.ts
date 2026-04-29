import { evaluateMonitorRules } from './rules'
import { validateMonitorUrlWithDns } from './ssrf'
import { MONITOR_LIMITS, MONITOR_RESPONSE_TYPE, MONITOR_STATUS, type NormalizedMonitorConfig } from './types'
import type { ComponentStatus } from '@/lib/types'

interface MonitorExecutionSuccess {
  checkStatus: typeof MONITOR_STATUS.SUCCESS
  resultingStatus: ComponentStatus
  httpStatus: number | null
  responseTimeMs: number
  errorMessage: null
}

interface MonitorExecutionFailure {
  checkStatus: typeof MONITOR_STATUS.FAILURE
  resultingStatus: ComponentStatus
  httpStatus: number | null
  responseTimeMs: number
  errorMessage: string
}

export type MonitorExecutionResult = MonitorExecutionSuccess | MonitorExecutionFailure

export async function executeMonitorCheck(config: NormalizedMonitorConfig): Promise<MonitorExecutionResult> {
  if (!config.url) return failure(config.failure_status, null, 0, 'Missing monitor URL.')

  const validation = await validateMonitorUrlWithDns(config.url)
  if (!validation.ok) return failure(config.failure_status, null, 0, validation.reason)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeout_ms)
  const startedAt = Date.now()

  try {
    const response = await fetch(validation.normalizedUrl, {
      method: config.method,
      body: null,
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: config.response_type === MONITOR_RESPONSE_TYPE.JSON ? 'application/json' : '*/*' },
    })
    const responseTimeMs = Date.now() - startedAt

    if (!config.expected_status_codes.includes(response.status)) {
      return failure(config.failure_status, response.status, responseTimeMs, `Unexpected HTTP status ${response.status}.`)
    }

    if (config.response_type === MONITOR_RESPONSE_TYPE.JSON) {
      const payload = await readLimitedJson(response)
      const evaluation = evaluateMonitorRules(payload, config.json_rules, config.no_match_status)
      return {
        checkStatus: MONITOR_STATUS.SUCCESS,
        resultingStatus: evaluation.status,
        httpStatus: response.status,
        responseTimeMs,
        errorMessage: null,
      }
    }

    return {
      checkStatus: MONITOR_STATUS.SUCCESS,
      resultingStatus: 'operational',
      httpStatus: response.status,
      responseTimeMs,
      errorMessage: null,
    }
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Request timed out.'
      : error instanceof Error ? error.message : 'Request failed.'
    return failure(config.failure_status, null, responseTimeMs, message)
  } finally {
    clearTimeout(timeout)
  }
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return null

  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MONITOR_LIMITS.MAX_RESPONSE_BYTES) throw new Error('Response body is too large.')
    chunks.push(value)
  }

  const body = new TextDecoder().decode(concatChunks(chunks, received))
  return JSON.parse(body)
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function failure(resultingStatus: ComponentStatus, httpStatus: number | null, responseTimeMs: number, errorMessage: string): MonitorExecutionFailure {
  return {
    checkStatus: MONITOR_STATUS.FAILURE,
    resultingStatus,
    httpStatus,
    responseTimeMs,
    errorMessage,
  }
}
