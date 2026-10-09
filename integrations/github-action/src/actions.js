// The few pieces of @actions/core this action needs, without dependencies.
import { appendFileSync } from 'node:fs'
import { EOL } from 'node:os'
import { randomUUID } from 'node:crypto'

export function input(name, env = process.env) {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim()
}

export function boolInput(name, env = process.env) {
  return /^(true|yes|1|on)$/i.test(input(name, env))
}

function fileCommand(file, key, value) {
  const delimiter = `ghadelimiter_${randomUUID()}`
  appendFileSync(file, `${key}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`)
}

export function setOutput(name, value, env = process.env) {
  if (env.GITHUB_OUTPUT) fileCommand(env.GITHUB_OUTPUT, name, value)
}

export function saveState(name, value, env = process.env) {
  if (env.GITHUB_STATE) fileCommand(env.GITHUB_STATE, name, value)
}

export function getState(name, env = process.env) {
  return env[`STATE_${name}`] ?? ''
}

const escape = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

export const log = {
  info: (message, out = process.stdout) => out.write(`${message}${EOL}`),
  warning: (message, out = process.stdout) => out.write(`::warning::${escape(message)}${EOL}`),
  error: (message, out = process.stdout) => out.write(`::error::${escape(message)}${EOL}`),
  mask: (secret, out = process.stdout) => secret && out.write(`::add-mask::${escape(secret)}${EOL}`),
}
