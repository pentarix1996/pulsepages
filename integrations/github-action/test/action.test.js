import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { run as runMain } from '../src/main.js'
import { run as runPost } from '../src/post.js'

function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const { status = 200, body = null } = (await handler(call, calls.length)) ?? {}
    return new Response(body === null ? null : JSON.stringify(body), { status })
  }
  return { fetchImpl, calls }
}

function setup(inputs = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'upvane-action-'))
  const files = { GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STATE: join(dir, 'state') }
  for (const file of Object.values(files)) writeFileSync(file, '')
  const env = { ...files, GITHUB_WORKFLOW: 'Deploy', GITHUB_REPOSITORY: 'acme/web' }
  const all = { 'api-key': 'upv_live_secret', project: 'acme', title: 'Deploy v2', 'api-url': 'https://api.test/v1', 'duration-minutes': '20', components: 'api, webhooks', 'notify-subscribers': 'false', 'mute-alerts': 'true', ...inputs }
  for (const [name, value] of Object.entries(all)) env[`INPUT_${name.toUpperCase()}`] = value
  let out = ''
  return { env, files, stream: { write: (text) => (out += text) }, output: () => out }
}

test('main opens and starts the window, saves state and outputs, masks the key', async () => {
  const { fetchImpl, calls } = fakeFetch((call) => ({ status: 201, body: { data: { id: 'mw-1', url: 'https://status.acme.com/maintenance/mw-1', status: call.url.endsWith('/start') ? 'in_progress' : 'scheduled' } } }))
  const { env, files, stream, output } = setup()
  const now = new Date('2026-10-09T12:00:00Z')
  assert.equal(await runMain({ env, fetchImpl, out: stream, now: () => now }), 0)
  assert.equal(calls[0].url, 'https://api.test/v1/projects/acme/maintenances')
  assert.equal(calls[0].headers.Authorization, 'Bearer upv_live_secret')
  assert.ok(calls[0].headers['Idempotency-Key'])
  assert.deepEqual(calls[0].body.components, ['api', 'webhooks'])
  assert.equal(calls[0].body.scheduled_start, '2026-10-09T12:00:00.000Z')
  assert.equal(calls[0].body.scheduled_end, '2026-10-09T12:20:00.000Z')
  assert.equal(calls[0].body.notify_subscribers, false)
  assert.equal(calls[0].body.mute_alerts, true)
  assert.match(calls[0].body.description, /Deploy in acme\/web/)
  assert.equal(calls[1].url, 'https://api.test/v1/projects/acme/maintenances/mw-1/start')
  assert.match(readFileSync(files.GITHUB_STATE, 'utf8'), /maintenance_id<<.*\nmw-1\n/)
  assert.match(readFileSync(files.GITHUB_OUTPUT, 'utf8'), /maintenance-id<<.*\nmw-1\n/)
  assert.match(output(), /::add-mask::upv_live_secret/)
})

test('main warns and lets the job continue when Upvane refuses', async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 403, body: { error: 'This key can only read.', code: 'forbidden' } }))
  const { env, stream, output } = setup()
  assert.equal(await runMain({ env, fetchImpl, out: stream }), 0)
  assert.match(output(), /::warning::Could not open the Upvane maintenance window: This key can only read. \(forbidden\)/)
})

test('fail-on-error fails the step', async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 404, body: { error: 'Status page not found.', code: 'not_found' } }))
  const { env, stream, output } = setup({ 'fail-on-error': 'true' })
  assert.equal(await runMain({ env, fetchImpl, out: stream }), 1)
  assert.match(output(), /::error::/)
})

test('post completes the window from the saved state and does nothing without it', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ body: { data: { id: 'mw-1', status: 'completed' } } }))
  const { env, stream } = setup({ 'complete-message': 'Deploy finished.' })
  assert.equal(await runPost({ env, fetchImpl, out: stream }), 0)
  assert.equal(calls.length, 0)
  env.STATE_maintenance_id = 'mw-1'
  assert.equal(await runPost({ env, fetchImpl, out: stream }), 0)
  assert.equal(calls[0].url, 'https://api.test/v1/projects/acme/maintenances/mw-1/complete')
  assert.deepEqual(calls[0].body, { message: 'Deploy finished.' })
})

test('server errors are retried', async () => {
  const { fetchImpl, calls } = fakeFetch((_call, n) => (n === 1 ? { status: 503, body: { error: 'Try again', code: 'unavailable' } } : { body: { data: { id: 'mw-2' } } }))
  const { api } = await import('../src/upvane.js')
  const result = await api(fetchImpl, { apiUrl: 'https://api.test/v1', apiKey: 'k' }, 'POST', '/x', {}, { delayMs: 1 })
  assert.deepEqual(result, { id: 'mw-2' })
  assert.equal(calls.length, 2)
})
