#!/usr/bin/env node
import { main } from '../src/main.js'

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`upvane: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  },
)
