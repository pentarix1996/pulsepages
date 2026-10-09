// upvane — command line for the Upvane API.
import { readFileSync } from 'node:fs'
import { list, parseArgs, parseComponentStatus, parseDuration, UsageError } from './args.js'
import { ApiError, createClient, DEFAULT_API_URL } from './client.js'
import { heartbeatUrl, ping, runWithHeartbeat } from './heartbeat.js'

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const HELP = `Upvane CLI ${VERSION}

Usage: upvane <command> [options]

Status
  status                                   Current status of the page and its components
  components list                          Components with their status
  components pin <key> <status>            Pin a component's status (operational, degraded, partial_outage,
                                           major_outage, maintenance)
  components unpin <key>                   Return a component to automatic status

Incidents
  incidents list [--active]                Recent incidents (or only the open ones)
  incidents create --title <text> [--impact minor|major|critical|none] [--status investigating]
                   [--component <key>=<status>]... [--message <text>] [--draft] [--no-notify]
  incidents update <id> --message <text> [--status identified|monitoring|resolved]
                   [--component <key>=<status>]... [--internal] [--no-notify]
  incidents resolve <id> [--message <text>]

Maintenance
  maintenance list                         Scheduled and in-progress windows
  maintenance create --title <text> (--start <iso> --end <iso> | --now --duration 30m)
                   [--component <key>]... [--description <text>] [--no-notify] [--no-mute]
  maintenance start|complete|cancel <id> [--message <text>]

Monitors
  monitors list                            Monitors with their state
  monitors run <id>                        Check now from every region
  monitors pause|resume <id>

Heartbeats (no API key needed)
  heartbeat <token|url>                    Report a successful run
  heartbeat <token|url> --fail [message]   Report a failed run
  heartbeat <token|url> -- <command...>    Run a command and report how it went

Other
  whoami                                   The API key in use and its organization

Options
  --project <key|id>   Status page (env UPVANE_PROJECT)
  --api-key <key>      API key (env UPVANE_API_KEY)
  --api-url <url>      API base URL (env UPVANE_API_URL, default ${DEFAULT_API_URL})
  --json               Print the API response as JSON
  -h, --help           Show this help
`

const BOOLEANS = ['json', 'help', 'active', 'draft', 'notify', 'internal', 'now', 'mute', 'version']

export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr, env: process.env, fetchImpl: globalThis.fetch }) {
  const out = (line = '') => io.stdout.write(`${line}\n`)
  let args
  try {
    args = parseArgs(argv, { booleans: BOOLEANS, repeatable: ['component'], aliases: { h: 'help', p: 'project', m: 'message', t: 'title' } })
  } catch (error) {
    io.stderr.write(`upvane: ${error.message}\n`)
    return 2
  }
  const { flags, positionals, rest } = args
  const [command, sub, ...more] = positionals
  if (flags.version) {
    out(VERSION)
    return 0
  }
  if (!command || flags.help || command === 'help') {
    out(HELP)
    return command || flags.help ? 0 : 2
  }

  const env = io.env ?? {}
  const apiUrl = String(flags['api-url'] ?? env.UPVANE_API_URL ?? DEFAULT_API_URL)
  const json = flags.json === true
  const print = (data, human) => (json ? out(JSON.stringify(data, null, 2)) : human(data))

  try {
    if (command === 'heartbeat') {
      if (!sub) throw new UsageError('Pass the heartbeat token: upvane heartbeat <token> -- ./job.sh')
      const url = heartbeatUrl(sub, apiUrl)
      if (rest && rest.length > 0) return await runWithHeartbeat(url, rest, { fetchImpl: io.fetchImpl, stderr: io.stderr })
      const failed = flags.fail !== undefined
      const message = typeof flags.fail === 'string' ? flags.fail : more.join(' ') || undefined
      const ok = await ping(url, { failed, message, fetchImpl: io.fetchImpl, log: (line) => io.stderr.write(`upvane: ${line}\n`) })
      if (ok) out(failed ? 'Failure reported.' : 'Heartbeat recorded.')
      return ok ? 0 : 1
    }

    const client = createClient({ apiUrl, apiKey: String(flags['api-key'] ?? env.UPVANE_API_KEY ?? ''), fetchImpl: io.fetchImpl, userAgent: `upvane-cli/${VERSION}` })
    const project = () => {
      const value = flags.project ?? env.UPVANE_PROJECT
      if (!value) throw new UsageError('Pass --project <key> or set UPVANE_PROJECT.')
      return `/projects/${encodeURIComponent(String(value))}`
    }
    const components = (fallback) => Object.fromEntries(list(flags.component).map((value) => parseComponentStatus(value, fallback)))
    const requireArg = (value, what) => {
      if (!value) throw new UsageError(`Missing ${what}.`)
      return encodeURIComponent(value)
    }

    switch (`${command} ${sub ?? ''}`.trim()) {
      case 'whoami': {
        const { data } = await client.get('/me')
        print(data, (me) => out(`${me.key?.name ?? 'API key'} (${(me.key?.scopes ?? []).join(', ')}) in ${me.organization?.name ?? 'your organization'}`))
        return 0
      }
      case 'status': {
        const { data } = await client.get(`${project()}/status`)
        print(data, (status) => {
          out(status.headline)
          for (const component of status.components ?? []) out(`  ${pad(component.status, 15)} ${component.name}`)
          for (const incident of status.active_incidents ?? []) out(`  Incident: ${incident.title} (${incident.status}, ${incident.impact})`)
        })
        return 0
      }
      case 'components list': {
        const items = await client.all(`${project()}/components`)
        print(items, (rows) => rows.forEach((row) => out(`${pad(row.slug, 24)} ${pad(row.status, 15)} ${row.name}${row.manual_status ? '  (pinned)' : ''}`)))
        return 0
      }
      case 'components pin':
      case 'components unpin': {
        const key = requireArg(more[0], 'component key')
        const status = sub === 'pin' ? more[1] : null
        if (sub === 'pin' && !status) throw new UsageError('Pass the status: upvane components pin <key> major_outage')
        const { data } = await client.put(`${project()}/components/${key}/status`, { status })
        print(data, (component) => out(sub === 'pin' ? `${component.name} pinned to ${component.status}.` : `${component.name} is back to automatic status (${component.status}).`))
        return 0
      }
      case 'incidents list': {
        const items = await client.all(`${project()}/incidents`, { status: flags.active ? 'active' : 'all' })
        print(items, (rows) => (rows.length === 0 ? out('No incidents.') : rows.forEach((row) => out(`${row.id}  ${pad(row.status, 13)} ${pad(row.impact, 9)} ${row.title}`))))
        return 0
      }
      case 'incidents create': {
        if (!flags.title) throw new UsageError('Pass --title.')
        const body = {
          title: String(flags.title),
          impact: flags.impact ? String(flags.impact) : undefined,
          status: flags.draft ? 'draft' : flags.status ? String(flags.status) : undefined,
          message: flags.message ? String(flags.message) : undefined,
          components: flags.component ? components('major_outage') : undefined,
          notify_subscribers: flags.notify === false ? false : undefined,
        }
        const { data } = await client.post(`${project()}/incidents`, body)
        print(data, (incident) => out(`${incident.status === 'draft' ? 'Draft created' : 'Incident declared'}: ${incident.title}\n${incident.id}`))
        return 0
      }
      case 'incidents update':
      case 'incidents resolve': {
        const id = requireArg(more[0], 'incident id')
        const resolving = sub === 'resolve'
        if (!resolving && !flags.message) throw new UsageError('Pass --message.')
        const body = {
          message: String(flags.message ?? 'This incident has been resolved.'),
          status: resolving ? 'resolved' : flags.status ? String(flags.status) : undefined,
          visibility: flags.internal ? 'internal' : 'public',
          components: flags.component ? components('operational') : undefined,
          notify_subscribers: flags.notify === false ? false : undefined,
        }
        const { data } = await client.post(`${project()}/incidents/${id}/updates`, body)
        print(data, () => out(resolving ? 'Incident resolved.' : 'Update posted.'))
        return 0
      }
      case 'maintenance list': {
        const items = [...(await client.all(`${project()}/maintenances`, { status: 'active' })), ...(await client.all(`${project()}/maintenances`, { status: 'upcoming' }))]
        print(items, (rows) => (rows.length === 0 ? out('No scheduled maintenance.') : rows.forEach((row) => out(`${row.id}  ${pad(row.status, 11)} ${row.scheduled_start} → ${row.scheduled_end}  ${row.title}`))))
        return 0
      }
      case 'maintenance create': {
        if (!flags.title) throw new UsageError('Pass --title.')
        let start = flags.start ? String(flags.start) : null
        let end = flags.end ? String(flags.end) : null
        if (flags.now) {
          const minutes = parseDuration(flags.duration ?? '30m')
          const now = new Date()
          start = now.toISOString()
          end = new Date(now.getTime() + minutes * 60_000).toISOString()
        } else if (start && !end && flags.duration) {
          end = new Date(new Date(start).getTime() + parseDuration(flags.duration) * 60_000).toISOString()
        }
        if (!start || !end) throw new UsageError('Pass --start and --end (ISO 8601), or --now --duration 30m.')
        const body = {
          title: String(flags.title),
          description: flags.description ? String(flags.description) : undefined,
          scheduled_start: start,
          scheduled_end: end,
          components: list(flags.component).map((value) => parseComponentStatus(value)[0]),
          notify_subscribers: flags.notify === false ? false : undefined,
          mute_alerts: flags.mute === false ? false : undefined,
        }
        let { data } = await client.post(`${project()}/maintenances`, body)
        if (flags.now) ({ data } = await client.post(`${project()}/maintenances/${data.id}/start`, flags.message ? { message: String(flags.message) } : {}))
        print(data, (window) => out(`${flags.now ? 'Maintenance started' : 'Maintenance scheduled'}: ${window.title}\n${window.id}`))
        return 0
      }
      case 'maintenance start':
      case 'maintenance complete':
      case 'maintenance cancel': {
        const id = requireArg(more[0], 'maintenance id')
        const { data } = await client.post(`${project()}/maintenances/${id}/${sub}`, flags.message ? { message: String(flags.message) } : {})
        print(data, (window) => out(`${window.title}: ${window.status.replace('_', ' ')}.`))
        return 0
      }
      case 'monitors list': {
        const items = await client.all(`${project()}/monitors`)
        print(items, (rows) => rows.forEach((row) => out(`${row.id}  ${pad(row.enabled ? row.state : 'paused', 9)} ${pad(row.type, 9)} ${row.name}`)))
        return 0
      }
      case 'monitors run': {
        const id = requireArg(more[0], 'monitor id')
        const { data } = await client.post(`${project()}/monitors/${id}/run`, {}, { idempotent: false })
        print(data, (run) => {
          out(`State: ${run.state ?? 'unknown'}`)
          for (const result of run.results ?? []) out(`  ${pad(result.region, 16)} ${pad(result.status, 9)} ${result.latency_ms ?? '-'} ms${result.error ? `  ${result.error}` : ''}`)
        })
        return 0
      }
      case 'monitors pause':
      case 'monitors resume': {
        const id = requireArg(more[0], 'monitor id')
        const { data } = await client.patch(`${project()}/monitors/${id}`, { enabled: sub === 'resume' })
        print(data, (monitor) => out(`${monitor.name} ${sub === 'resume' ? 'resumed' : 'paused'}.`))
        return 0
      }
      default:
        throw new UsageError(`Unknown command "${positionals.join(' ')}". Run upvane --help.`)
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`upvane: ${error.message}\n`)
      return 2
    }
    if (error instanceof ApiError) {
      io.stderr.write(`upvane: ${error.message}${error.code && error.code !== 'http_error' ? ` (${error.code})` : ''}\n`)
      for (const detail of Array.isArray(error.details) ? error.details : []) io.stderr.write(`  ${detail.path}: ${detail.message}\n`)
      return 1
    }
    throw error
  }
}

function pad(value, width) {
  const text = String(value ?? '')
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}
