// Tiny argument parser: positional arguments, --flag value, --flag=value, repeatable flags, booleans and `--`.

/**
 * @param {string[]} argv
 * @param {{ booleans?: string[], repeatable?: string[], aliases?: Record<string, string> }} spec
 */
export function parseArgs(argv, spec = {}) {
  const booleans = new Set(spec.booleans ?? [])
  const repeatable = new Set(spec.repeatable ?? [])
  const aliases = spec.aliases ?? {}
  /** @type {Record<string, string | boolean | string[]>} */
  const flags = {}
  const positionals = []
  let rest = null
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      rest = argv.slice(index + 1)
      break
    }
    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2 && arg !== '-')) {
      let name = arg.startsWith('--') ? arg.slice(2) : aliases[arg.slice(1)] ?? arg.slice(1)
      let value
      const eq = name.indexOf('=')
      if (eq !== -1) {
        value = name.slice(eq + 1)
        name = name.slice(0, eq)
      }
      name = aliases[name] ?? name
      if (booleans.has(name)) {
        if (name.startsWith('no-')) flags[name.slice(3)] = false
        else flags[name] = value === undefined ? true : value !== 'false'
        continue
      }
      if (name.startsWith('no-') && booleans.has(name.slice(3))) {
        flags[name.slice(3)] = false
        continue
      }
      if (value === undefined) {
        value = argv[index + 1]
        if (value === undefined || (value.startsWith('--') && value.length > 2)) throw new UsageError(`--${name} needs a value.`)
        index++
      }
      if (repeatable.has(name)) flags[name] = [...(/** @type {string[]} */ (flags[name]) ?? []), value]
      else flags[name] = value
      continue
    }
    positionals.push(arg)
  }
  return { flags, positionals, rest }
}

export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/** "30m", "2h", "90" (minutes), "1h30m" → minutes. */
export function parseDuration(value) {
  const text = String(value).trim().toLowerCase()
  if (/^\d+$/.test(text)) return Number(text)
  const match = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text)
  if (!match || (!match[1] && !match[2])) throw new UsageError(`Use a duration such as 30m, 2h or 1h30m (got "${value}").`)
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

/** "api=major_outage" → ["api", "major_outage"]; "api" → ["api", fallback]. */
export function parseComponentStatus(value, fallback) {
  const [key, status] = String(value).split('=')
  if (!key) throw new UsageError(`Use --component <key>=<status>, such as api=major_outage.`)
  return [key.trim(), (status ?? fallback ?? '').trim() || fallback]
}

/** Comma-separated or repeated values → list. */
export function list(value) {
  if (value === undefined || value === false) return []
  const values = Array.isArray(value) ? value : [String(value)]
  return values.flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean)
}
