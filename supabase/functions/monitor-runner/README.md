# monitor-runner

Supabase Edge Function invoked by one global cron every minute.

Required secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MONITOR_RUNNER_SECRET`

Deploy and schedule:

1. `supabase functions deploy monitor-runner`
2. Store `MONITOR_RUNNER_SECRET` in Supabase Edge Function secrets.
3. Store these Supabase Vault secrets, without hardcoding them in SQL:
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `MONITOR_RUNNER_SECRET` = same bearer token configured for the Edge Function.
4. Apply/rerun the cron section in `supabase/migrations/20260428160000_add_monitoring_pingers.sql`.
   It creates `pg_cron`, `pg_net`, and `supabase_vault` when available, then schedules exactly one job:
   `monitor-runner-every-minute` with schedule `* * * * *`.

The function rejects unauthenticated calls and uses `fetch` only. It does not follow redirects, blocks localhost/private/reserved IP literals, and resolves DNS before every request to reject hostnames that resolve to private, loopback, link-local, metadata, multicast, or reserved ranges.

Runtime requirement: the Edge Function runtime must expose `Deno.resolveDns` with DNS network permission. If DNS resolution is unavailable, the runner fails closed and does not call the target URL.
