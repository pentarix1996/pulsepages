// Post step (always runs): complete the window opened by the main step.
import { boolInput, getState, input, log } from './actions.js'
import { api, projectPath } from './upvane.js'

export async function run({ env = process.env, fetchImpl = globalThis.fetch, out = process.stdout } = {}) {
  const id = getState('maintenance_id', env)
  if (!id) return 0
  const apiKey = input('api-key', env)
  log.mask(apiKey, out)
  const settings = { apiUrl: input('api-url', env) || 'https://api.upvane.com/v1', apiKey }
  try {
    const message = input('complete-message', env) || 'The work is done.'
    await api(fetchImpl, settings, 'POST', `${projectPath(input('project', env))}/maintenances/${encodeURIComponent(id)}/complete`, { message })
    log.info(`Maintenance window ${id} completed.`, out)
    return 0
  } catch (error) {
    const text = `Could not complete the Upvane maintenance window ${id}: ${error instanceof Error ? error.message : error}. It completes on its own at its scheduled end.`
    if (boolInput('fail-on-error', env)) {
      log.error(text, out)
      return 1
    }
    log.warning(text, out)
    return 0
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((code) => process.exit(code))
}
