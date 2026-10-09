// `upvane heartbeat <token> -- <command>`: runs the command and reports the result to a heartbeat monitor.
import { spawn } from 'node:child_process'
import { DEFAULT_API_URL } from './client.js'

const TAIL_BYTES = 400

/** Ping URL from a token or a full ping URL (as copied from the dashboard). */
export function heartbeatUrl(tokenOrUrl, apiUrl = DEFAULT_API_URL) {
  if (/^https?:\/\//i.test(tokenOrUrl)) return tokenOrUrl.replace(/\/fail\/?$/, '').replace(/\/+$/, '')
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(tokenOrUrl)) throw new Error('Pass the heartbeat token or the ping URL from the monitor page.')
  return `${apiUrl.replace(/\/+$/, '')}/heartbeat/${tokenOrUrl}`
}

/** Sends the ping, retrying network errors and 5xx answers. Returns true when Upvane recorded it. */
export async function ping(url, { failed = false, message, fetchImpl = globalThis.fetch, attempts = 3, log = () => {} } = {}) {
  const target = failed ? `${url}/fail` : url
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(target, {
        method: 'POST',
        headers: failed ? { 'Content-Type': 'application/json' } : undefined,
        body: failed ? JSON.stringify({ message: (message ?? 'The job failed.').slice(0, 500) }) : undefined,
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) return true
      if (response.status < 500 && response.status !== 429) {
        log(`Upvane answered ${response.status} to the heartbeat. Check the token.`)
        return false
      }
      log(`Upvane answered ${response.status}; retrying.`)
    } catch (error) {
      log(`Could not reach Upvane (${error instanceof Error ? error.message : error}); retrying.`)
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
  }
  return false
}

/** Runs `command`, forwards its output and signals, and reports success or failure. Resolves to its exit code. */
export function runWithHeartbeat(url, command, { fetchImpl, stderr = process.stderr, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawnImpl(command[0], command.slice(1), { stdio: ['inherit', 'inherit', 'pipe'], shell: false })
    let tail = ''
    child.stderr?.on('data', (chunk) => {
      stderr.write(chunk)
      tail = (tail + chunk.toString('utf8')).slice(-TAIL_BYTES)
    })
    const forward = (signal) => () => child.kill(signal)
    const onInt = forward('SIGINT')
    const onTerm = forward('SIGTERM')
    process.on('SIGINT', onInt)
    process.on('SIGTERM', onTerm)
    const finish = async (code, reason) => {
      process.off('SIGINT', onInt)
      process.off('SIGTERM', onTerm)
      const seconds = Math.round((Date.now() - started) / 1000)
      const ok = code === 0
      const message = ok ? undefined : `${reason} after ${seconds} s${tail.trim() ? `: ${tail.trim().split('\n').slice(-3).join(' | ')}` : ''}`
      const recorded = await ping(url, { failed: !ok, message, fetchImpl, log: (line) => stderr.write(`upvane: ${line}\n`) })
      if (!recorded) stderr.write('upvane: the heartbeat was not recorded; the monitor may report the job as missing.\n')
      resolve(code)
    }
    child.on('error', (error) => void finish(127, `Could not start ${command[0]} (${error.message})`))
    child.on('exit', (code, signal) => void finish(code ?? 1, signal ? `Stopped by ${signal}` : `Exited with code ${code}`))
  })
}
