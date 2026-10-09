# @upvane/cli

Upvane from the terminal and from CI: declare incidents, post updates, schedule maintenance, pin component status,
run monitors and report cron jobs to heartbeat monitors. No dependencies; Node 18.17 or newer.

```sh
npm install -g @upvane/cli        # or: npx @upvane/cli <command>

export UPVANE_API_KEY=upv_live_…   # Settings → API keys (a write key for anything that changes)
export UPVANE_PROJECT=my-status-page
```

## Examples

```sh
# Declare an incident from a runbook, then follow up
upvane incidents create --title "Failed payments in EU" --impact major \
  --component payments-api=major_outage --message "Payments are failing. Retries are safe."
upvane incidents update <id> --status identified --message "A connection limit is the cause."
upvane incidents resolve <id> --message "Payments work again." --component payments-api=operational

# Announce a deploy window that starts now
upvane maintenance create --title "Deploy v2.4" --now --duration 15m --component api,webhooks
upvane maintenance complete <id> --message "Deploy finished."

# Pin a status by hand, then hand it back to the monitors
upvane components pin payments-api degraded
upvane components unpin payments-api

# Wrap a cron job: pings on success, reports the exit code and the last stderr lines on failure.
# The heartbeat token (or the full ping URL) is on the monitor page; no API key is needed.
upvane heartbeat "$BACKUP_HEARTBEAT_TOKEN" -- ./nightly-backup.sh
```

Every command accepts `--json` to print the API response, `--project`, `--api-key` and `--api-url`
(`UPVANE_API_URL`, for self-hosted Upvane). `upvane --help` lists everything.

Exit codes: `0` success, `1` the API refused the request (the message says why), `2` wrong usage. `heartbeat -- <cmd>`
exits with the command's own code.

Write requests carry an `Idempotency-Key`, so the CLI retries rate limits and server errors without creating
duplicates.

## Develop

```sh
npm test          # node:test, no dependencies
UPVANE_API_URL=http://localhost:3000/api/v1 UPVANE_API_KEY=upv_live_demo0000000000000000000000000000000000 \
  UPVANE_PROJECT=status node bin/upvane.js status
```
