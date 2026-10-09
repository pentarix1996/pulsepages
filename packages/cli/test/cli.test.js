import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArgs, parseComponentStatus, parseDuration } from '../src/args.js'
import { createClient } from '../src/client.js'
import { heartbeatUrl, ping } from '../src/heartbeat.js'
import { main } from '../src/main.js'

function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const { status = 200, body = null, headers = {} } = (await handler(call, calls.length)) ?? {}
    return new Response(body === null ? null : JSON.stringify(body), { status, headers })
  }
  return { fetchImpl, calls }
}

function io(fetchImpl, env = {}) {
  let stdout = ''
  let stderr = ''
  return {
    io: { stdout: { write: (text) => (stdout += text) }, stderr: { write: (text) => (stderr += text) }, env: { UPVANE_API_KEY: 'upv_live_test', UPVANE_API_URL: 'https://api.test/v1', UPVANE_PROJECT: 'acme', ...env }, fetchImpl },
    output: () => ({ stdout, stderr }),
  }
}

test('parseArgs handles flags, repeats, booleans, negation and --', () => {
  const { flags, positionals, rest } = parseArgs(['incidents', 'create', '--title', 'Down', '--component', 'api=major_outage', '--component=db', '--no-notify', '--json', '--', 'x'], {
    booleans: ['json', 'notify'],
    repeatable: ['component'],
  })
  assert.deepEqual(positionals, ['incidents', 'create'])
  assert.equal(flags.title, 'Down')
  assert.deepEqual(flags.component, ['api=major_outage', 'db'])
  assert.equal(flags.notify, false)
  assert.equal(flags.json, true)
  assert.deepEqual(rest, ['x'])
  assert.throws(() => parseArgs(['--title']), /needs a value/)
})

test('durations and component statuses', () => {
  assert.equal(parseDuration('90'), 90)
  assert.equal(parseDuration('2h'), 120)
  assert.equal(parseDuration('1h30m'), 90)
  assert.throws(() => parseDuration('soon'), /duration/)
  assert.deepEqual(parseComponentStatus('api=degraded'), ['api', 'degraded'])
  assert.deepEqual(parseComponentStatus('api', 'major_outage'), ['api', 'major_outage'])
})

test('heartbeatUrl accepts tokens and ping URLs', () => {
  assert.equal(heartbeatUrl('abcdef123456', 'https://api.test/v1/'), 'https://api.test/v1/heartbeat/abcdef123456')
  assert.equal(heartbeatUrl('https://app.test/api/v1/heartbeat/abc12345/fail'), 'https://app.test/api/v1/heartbeat/abc12345')
  assert.throws(() => heartbeatUrl('no spaces allowed'), /token/)
})

test('ping retries server errors and reports failures with a message', async () => {
  const { fetchImpl, calls } = fakeFetch((_call, n) => (n === 1 ? { status: 503 } : { status: 200, body: { data: { state: 'down' } } }))
  const ok = await ping('https://api.test/v1/heartbeat/abc12345', { failed: true, message: 'exit 3', fetchImpl, attempts: 2 })
  assert.equal(ok, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, 'https://api.test/v1/heartbeat/abc12345/fail')
  assert.deepEqual(calls[1].body, { message: 'exit 3' })
})

test('ping does not retry a wrong token', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 404, body: { error: 'Not found', code: 'not_found' } }))
  assert.equal(await ping('https://api.test/v1/heartbeat/abc12345', { fetchImpl, attempts: 3 }), false)
  assert.equal(calls.length, 1)
})

test('incidents create sends the body, the key and an idempotency key', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 201, body: { data: { id: 'inc-1', title: 'API down', status: 'investigating' } } }))
  const { io: streams, output } = io(fetchImpl)
  const code = await main(['incidents', 'create', '--title', 'API down', '--impact', 'major', '--component', 'api=major_outage', '--message', 'Looking.', '--no-notify'], streams)
  assert.equal(code, 0)
  assert.equal(calls[0].url, 'https://api.test/v1/projects/acme/incidents')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].headers.Authorization, 'Bearer upv_live_test')
  assert.ok(calls[0].headers['Idempotency-Key'])
  assert.deepEqual(calls[0].body, { title: 'API down', impact: 'major', message: 'Looking.', components: { api: 'major_outage' }, notify_subscribers: false })
  assert.match(output().stdout, /Incident declared: API down/)
})

test('maintenance create --now starts the window right away', async () => {
  const { fetchImpl, calls } = fakeFetch((call) => ({ status: 201, body: { data: { id: 'mw-1', title: 'Deploy', status: call.url.endsWith('/start') ? 'in_progress' : 'scheduled' } } }))
  const { io: streams } = io(fetchImpl)
  const code = await main(['maintenance', 'create', '--title', 'Deploy', '--now', '--duration', '15m', '--component', 'api,webhooks'], streams)
  assert.equal(code, 0)
  assert.equal(calls.length, 2)
  const body = calls[0].body
  assert.deepEqual(body.components, ['api', 'webhooks'])
  assert.equal(new Date(body.scheduled_end).getTime() - new Date(body.scheduled_start).getTime(), 15 * 60_000)
  assert.equal(calls[1].url, 'https://api.test/v1/projects/acme/maintenances/mw-1/start')
})

test('API errors print the message and field details, exit 1', async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 422, body: { error: 'Invalid request', code: 'invalid_request', details: [{ path: 'impact', message: 'Use minor, major or critical.' }] } }))
  const { io: streams, output } = io(fetchImpl)
  assert.equal(await main(['incidents', 'create', '--title', 'X', '--impact', 'huge'], streams), 1)
  assert.match(output().stderr, /impact: Use minor, major or critical/)
})

test('usage errors exit 2 and missing keys explain how to get one', async () => {
  const { fetchImpl } = fakeFetch(() => ({}))
  const missingProject = io(fetchImpl, { UPVANE_PROJECT: '' })
  assert.equal(await main(['incidents', 'list'], missingProject.io), 2)
  assert.match(missingProject.output().stderr, /--project/)
  const noKey = io(fetchImpl, { UPVANE_API_KEY: '' })
  assert.equal(await main(['status'], noKey.io), 1)
  assert.match(noKey.output().stderr, /UPVANE_API_KEY/)
})

test('client.all follows next_cursor', async () => {
  const { fetchImpl, calls } = fakeFetch((call) => (call.url.includes('cursor=c2') ? { body: { data: [{ id: 2 }], next_cursor: null } } : { body: { data: [{ id: 1 }], next_cursor: 'c2' } }))
  const client = createClient({ apiUrl: 'https://api.test/v1', apiKey: 'k', fetchImpl })
  assert.deepEqual(await client.all('/projects/acme/incidents'), [{ id: 1 }, { id: 2 }])
  assert.equal(calls.length, 2)
})
