// Structured logs: one JSON object per line, so the Supabase log explorer can filter on fields.
// Never pass secrets, tokens or decrypted values in `fields`.
import { errorChainText } from '../monitoring/probe.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Record<string, unknown>
export type Logger = (level: LogLevel, event: string, fields?: LogFields) => void

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  let line: string
  try {
    line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields })
  } catch {
    line = JSON.stringify({ level, event, at: new Date().toISOString(), note: 'fields were not serializable' })
  }
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** A logger that drops everything (tests). */
export const silentLogger: Logger = () => {}

/** Error text for logs: message plus causes, capped. */
export function errorMessage(error: unknown): string {
  const text = errorChainText(error) || String(error)
  return text.length > 500 ? `${text.slice(0, 499)}…` : text
}
