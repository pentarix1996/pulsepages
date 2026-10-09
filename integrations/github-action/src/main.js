// Main step: announce the maintenance window and start it right away.
import { boolInput, input, log, saveState, setOutput } from './actions.js'
import { api, projectPath } from './upvane.js'

export async function run({ env = process.env, fetchImpl = globalThis.fetch, out = process.stdout, now = () => new Date() } = {}) {
  const apiKey = input('api-key', env)
  log.mask(apiKey, out)
  const settings = { apiUrl: input('api-url', env) || 'https://api.upvane.com/v1', apiKey }
  const project = input('project', env)
  const title = input('title', env)
  const failOnError = boolInput('fail-on-error', env)
  try {
    if (!apiKey || !project || !title) throw new Error('api-key, project and title are required.')
    const minutes = Number(input('duration-minutes', env) || 30)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('duration-minutes must be between 1 and 1440.')
    const start = now()
    const end = new Date(start.getTime() + minutes * 60_000)
    const components = input('components', env)
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
    const created = await api(fetchImpl, settings, 'POST', `${projectPath(project)}/maintenances`, {
      title,
      description: input('description', env) || `Started by ${env.GITHUB_WORKFLOW ?? 'a GitHub workflow'}${env.GITHUB_REPOSITORY ? ` in ${env.GITHUB_REPOSITORY}` : ''}.`,
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
      components,
      notify_subscribers: boolInput('notify-subscribers', env),
      mute_alerts: input('mute-alerts', env) === '' ? true : boolInput('mute-alerts', env),
      reminder_minutes: 0,
      auto_complete: true,
    })
    saveState('maintenance_id', created.id, env)
    const started = await api(fetchImpl, settings, 'POST', `${projectPath(project)}/maintenances/${created.id}/start`, {})
    setOutput('maintenance-id', created.id, env)
    if (started?.url ?? created.url) setOutput('url', started?.url ?? created.url, env)
    log.info(`Maintenance window "${title}" is open (${created.id}). It closes when this job ends, or at ${end.toISOString()} at the latest.`, out)
    return 0
  } catch (error) {
    const message = `Could not open the Upvane maintenance window: ${error instanceof Error ? error.message : error}`
    if (failOnError) {
      log.error(message, out)
      return 1
    }
    log.warning(`${message}. The job continues.`, out)
    return 0
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((code) => process.exit(code))
}
